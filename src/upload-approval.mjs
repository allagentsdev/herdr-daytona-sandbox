import path from "node:path";
import { randomUUID } from "node:crypto";
import readline from "node:readline";
import { captureSnapshot, readSnapshot } from "./manifest.mjs";
import { PluginError, safeText } from "./result.mjs";
import { show } from "./terminal-ui.mjs";

function confirmUpload(prompt, input, output) {
  if (!input.isTTY || !output.isTTY)
    throw new PluginError(
      "interactive_required",
      "Upload review saved locally. Explicit approval in an interactive start pane is required; nothing was uploaded.",
    );
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input, output });
    const finish = (answer) => {
      resolve(answer);
      rl.close();
    };
    rl.once("line", finish);
    rl.once("close", () => resolve(null));
    rl.once("SIGINT", () => finish(null));
    rl.setPrompt(safeText(prompt));
    rl.prompt();
  });
}

export async function captureAndApproveUpload(
  store,
  record,
  { input = process.stdin, output = process.stdout } = {},
) {
  return store.withLock(record.id, async () => {
    record = store.get(record.id);
    if (
      record.sandboxId ||
      record.creationAttempted ||
      record.uploadApproval ||
      !["provisional", "upload-cancelled"].includes(record.phase)
    )
      throw new PluginError(
        "upload_already_reviewed",
        "This association already owns an upload review or sandbox. Reconnect to it, or start a fresh association.",
      );
    const snapshot = captureSnapshot(
      record.localRoot,
      record.config,
      path.join(store.artifacts(record.id), `baseline-${randomUUID()}`),
    );
    await store.update(record.id, (v) => ({
      ...v,
      baseline: snapshot.directory,
      baselineDigest: snapshot.digest,
      phase: "upload-review",
      uploadApproval: null,
    }));
    show(
      `Upload review\nAssociation: ${record.id}\nAgent: ${record.config.agent}\nRegion: ${record.config.region}\nDestination: ${record.config.remoteRoot}\n${record.config.snapshot ? `Snapshot: ${record.config.snapshot}` : `Image: ${record.config.image}`}\nStaged baseline: ${snapshot.directory}\nManifest SHA-256: ${snapshot.digest}\nUpload: ${snapshot.files.length} files, ${snapshot.totalBytes} bytes; ${snapshot.excluded.length} paths skipped.\nComplete eligible manifest (path, bytes, mode, SHA-256):\n${snapshot.files.map((f) => `${JSON.stringify(f.path)}\t${f.size}\t${f.mode}\t${f.sha256}`).join("\n")}\nOnly these staged bytes will be uploaded. Review ordinary source files for secrets not detected by the filters.`,
      output,
    );
    try {
      const answer = await confirmUpload(
        `Type UPLOAD ${snapshot.digest} to upload to ${record.config.remoteRoot} (anything else cancels) > `,
        input,
        output,
      );
      if (answer !== `UPLOAD ${snapshot.digest}`)
        throw new PluginError(
          "upload_cancelled",
          "Upload cancelled. The local baseline is retained; no sandbox was allocated and nothing was uploaded.",
        );
      const approved = readSnapshot(snapshot.directory);
      if (approved.digest !== snapshot.digest)
        throw new PluginError(
          "snapshot_corrupt",
          "The staged manifest changed after review. Start again to review a fresh snapshot.",
        );
      await store.update(record.id, (v) => ({
        ...v,
        phase: "upload-approved",
        uploadApproval: {
          digest: snapshot.digest,
          destination: record.config.remoteRoot,
          approvedAt: new Date().toISOString(),
        },
      }));
      return approved;
    } catch (e) {
      await store.update(record.id, (v) => ({
        ...v,
        phase: "upload-cancelled",
      }));
      throw e;
    }
  });
}
