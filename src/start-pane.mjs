#!/usr/bin/env node
import path from "node:path";
import { randomUUID } from "node:crypto";
import { captureSnapshot } from "./manifest.mjs";
import { DaytonaProvider, provision } from "./sandbox.mjs";
import { attachAgent } from "./terminal.mjs";
import { paneAssociation, runPane } from "./pane-runtime.mjs";
import { show } from "./terminal-ui.mjs";

await runPane("start-agent", async () => {
  const { store, record: r } = paneAssociation();
  show(
    `Association: ${r.id}\nAgent: ${r.config.agent}\nRegion: ${r.config.region}\nDestination: ${r.config.remoteRoot}\nCapturing filtered worktree...`,
  );
  const snapshot = captureSnapshot(
    r.localRoot,
    r.config,
    path.join(store.artifacts(r.id), `baseline-${randomUUID()}`),
  );
  show(
    `Upload: ${snapshot.files.length} files, ${snapshot.totalBytes} bytes; ${snapshot.excluded.length} paths skipped.\n${snapshot.files.map((f) => JSON.stringify(f.path)).join("\n")}`,
  );
  await store.update(r.id, (v) => ({
    ...v,
    baseline: snapshot.directory,
    baselineDigest: snapshot.digest,
    remotePaneId: process.env.HERDR_PANE_ID ?? null,
  }));
  const provider = await DaytonaProvider.connect(r.config, store);
  await provision(store, r.id, provider, show);
  show(
    "Ready. Closing this pane disconnects transport and retains the sandbox.",
  );
  await attachAgent(store, r.id, provider);
});
