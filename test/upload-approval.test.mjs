import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { PassThrough } from "node:stream";
import { Store, namespace } from "../src/state.mjs";
import { validateConfig } from "../src/config.mjs";
import { captureAndApproveUpload } from "../src/upload-approval.mjs";
import { readSnapshot, saveSnapshot } from "../src/manifest.mjs";
import { repository, temporary, write } from "./helpers.mjs";

async function association(t) {
  const root = repository(t),
    store = new Store(temporary(t)),
    env = { HERDR_SOCKET_PATH: "/upload-review-test" },
    id = randomUUID();
  write(root, "source", "captured bytes\n");
  const record = await store.create({
    id,
    namespace: namespace(env),
    localRoot: root,
    relativeCwd: ".",
    config: validateConfig({ snapshot: "literal-snapshot-id" }),
    phase: "provisional",
    sandboxId: null,
  });
  return { root, store, record, env };
}

test("real start pane saves its review and stops nonTTY before provider connection", async (t) => {
  const { store, record, env } = await association(t);
  const preload = `import { DaytonaProvider } from ${JSON.stringify(new URL("../src/sandbox.mjs", import.meta.url).href)};
    import { PluginError } from ${JSON.stringify(new URL("../src/result.mjs", import.meta.url).href)};
    DaytonaProvider.connect = async () => { throw new PluginError("provider_before_approval", "PROVIDER_CONNECT_WAS_CALLED"); };`;
  const pane = spawnSync(
    process.execPath,
    [
      "--import",
      `data:text/javascript,${encodeURIComponent(preload)}`,
      new URL("../src/start-pane.mjs", import.meta.url).pathname,
    ],
    {
      env: {
        PATH: process.env.PATH,
        ...env,
        HERDR_PLUGIN_STATE_DIR: store.directory,
        DAYTONA_ASSOCIATION: record.id,
      },
      encoding: "utf8",
    },
  );
  assert.equal(pane.status, 1);
  assert.match(pane.stdout, /interactive_required/);
  assert.doesNotMatch(pane.stdout + pane.stderr, /PROVIDER_CONNECT_WAS_CALLED/);
  const retained = store.get(record.id);
  assert.equal(retained.phase, "upload-cancelled");
  assert.equal(retained.sandboxId, null);
  assert.equal(retained.creationAttempted, undefined);
  assert.equal(retained.uploadApproval, null);
  assert.ok(fs.existsSync(path.join(retained.baseline, "manifest.json")));
  assert.match(pane.stdout, new RegExp(retained.baselineDigest));
  assert.match(pane.stdout, /literal-snapshot-id/);
  assert.match(pane.stdout, /"source"/);
});

test("real start pane reaches the provider only after exact TTY approval", async (t) => {
  for (const approve of [false, true]) {
    const { root, store, record, env } = await association(t);
    const preload = `import { DaytonaProvider } from ${JSON.stringify(new URL("../src/sandbox.mjs", import.meta.url).href)};
      import { PluginError } from ${JSON.stringify(new URL("../src/result.mjs", import.meta.url).href)};
      process.stdin.isTTY = true;
      process.stdout.isTTY = true;
      DaytonaProvider.connect = async () => {
        process.stdin.isTTY = false;
        throw new PluginError("approved_provider_boundary", "Approved provider connection reached.");
      };`;
    const pane = spawn(
      process.execPath,
      [
        "--import",
        `data:text/javascript,${encodeURIComponent(preload)}`,
        new URL("../src/start-pane.mjs", import.meta.url).pathname,
      ],
      {
        env: {
          PATH: process.env.PATH,
          ...env,
          HERDR_PLUGIN_STATE_DIR: store.directory,
          DAYTONA_ASSOCIATION: record.id,
        },
      },
    );
    t.after(() => pane.kill());
    let output = "",
      responded = false;
    pane.stdout.on("data", (data) => {
      output += data.toString();
      if (!responded && output.includes("(anything else cancels) > ")) {
        responded = true;
        const staged = store.get(record.id);
        assert.equal(staged.phase, "upload-review");
        assert.equal(staged.creationAttempted, undefined);
        assert.equal(staged.sandboxId, null);
        write(root, "source", "live mutation after review");
        pane.stdin.write(
          approve ? `UPLOAD ${staged.baselineDigest}\n` : "cancel\n",
        );
      }
      if (output.includes("Press Enter to close.")) pane.stdin.end("\n");
      if (output.includes("approved_provider_boundary")) pane.stdin.end();
    });
    pane.stderr.on("data", (data) => {
      output += data.toString();
    });
    const exit = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        pane.kill();
        reject(new Error(output));
      }, 3000);
      pane.once("error", reject);
      pane.once("exit", (code) => {
        clearTimeout(timeout);
        resolve(code);
      });
    });
    assert.equal(exit, 1, output);
    assert.equal(responded, true);
    const retained = store.get(record.id);
    assert.equal(
      retained.phase,
      approve ? "upload-approved" : "upload-cancelled",
    );
    assert.equal(
      fs.readFileSync(path.join(retained.baseline, "files/source"), "utf8"),
      "captured bytes\n",
    );
    if (approve) {
      assert.match(output, /approved_provider_boundary/);
      assert.equal(retained.uploadApproval.digest, retained.baselineDigest);
    } else {
      assert.match(output, /upload_cancelled/);
      assert.doesNotMatch(output, /approved_provider_boundary/);
      assert.equal(retained.uploadApproval, null);
    }
  }
});

function terminal(onPrompt, { interactive = true } = {}) {
  const input = new PassThrough(),
    output = new PassThrough();
  input.isTTY = interactive;
  output.isTTY = interactive;
  let text = "",
    prompted = false;
  output.on("data", (data) => {
    text += data.toString();
    if (!prompted && text.includes("(anything else cancels) > ")) {
      prompted = true;
      queueMicrotask(() => onPrompt(input, text));
    }
  });
  return { input, output, text: () => text };
}

test("typed digest approves the complete filtered staged bytes while the live tree changes", async (t) => {
  const { root, store, record } = await association(t);
  write(root, "binary", Buffer.from([0, 255, 128]), 0o755);
  write(root, "line\nbreak", "odd path");
  write(root, ".env", "private");
  write(root, "secret.txt", "-----BEGIN PRIVATE KEY-----");
  fs.symlinkSync("source", path.join(root, "link"));
  let reviewed;
  const io = terminal((input, text) => {
    reviewed = store.get(record.id);
    assert.equal(reviewed.phase, "upload-review");
    assert.equal(reviewed.uploadApproval, null);
    const snapshot = readSnapshot(reviewed.baseline);
    assert.equal(snapshot.digest, reviewed.baselineDigest);
    for (const f of snapshot.files) {
      assert.ok(text.includes(JSON.stringify(f.path)));
      assert.ok(text.includes(f.sha256));
    }
    assert.ok(text.includes(`${snapshot.totalBytes} bytes`));
    write(root, "source", "new live bytes\n");
    write(root, "new-after-review", "must not upload");
    input.write(`UPLOAD ${snapshot.digest}\n`);
  });
  const approved = await captureAndApproveUpload(store, record, io);
  assert.equal(approved.digest, reviewed.baselineDigest);
  assert.deepEqual(
    approved.files.map((f) => f.path),
    ["binary", "line\nbreak", "source"],
  );
  assert.equal(approved.files.find((f) => f.path === "binary").mode, "100755");
  assert.equal(
    fs.readFileSync(path.join(approved.directory, "files/source"), "utf8"),
    "captured bytes\n",
  );
  assert.deepEqual(
    fs.readFileSync(path.join(approved.directory, "files/binary")),
    Buffer.from([0, 255, 128]),
  );
  assert.equal(store.get(record.id).phase, "upload-approved");
  assert.equal(store.get(record.id).uploadApproval.digest, approved.digest);
  assert.equal(
    store.get(record.id).uploadApproval.destination,
    record.config.remoteRoot,
  );
});

test("empty, generic, wrong digest and EOF cancel with a retained baseline", async (t) => {
  for (const response of ["", "UPLOAD", "UPLOAD wrong", "yes", null]) {
    const { store, record } = await association(t);
    const io = terminal((input) => {
      if (response === null) input.end();
      else input.write(`${response}\n`);
    });
    await assert.rejects(captureAndApproveUpload(store, record, io), {
      code: "upload_cancelled",
    });
    const retained = store.get(record.id);
    assert.equal(retained.phase, "upload-cancelled");
    assert.equal(retained.uploadApproval, null);
    assert.equal(
      readSnapshot(retained.baseline).digest,
      retained.baselineDigest,
    );
  }
});

test("an otherwise valid replacement staged manifest cannot inherit review approval", async (t) => {
  const { store, record } = await association(t);
  const io = terminal((input) => {
    const staged = store.get(record.id);
    fs.rmSync(staged.baseline, { recursive: true });
    saveSnapshot(staged.baseline, [
      { path: "source", bytes: Buffer.from("replacement"), mode: "100644" },
    ]);
    input.write(`UPLOAD ${staged.baselineDigest}\n`);
  });
  await assert.rejects(captureAndApproveUpload(store, record, io), {
    code: "snapshot_corrupt",
  });
  assert.equal(store.get(record.id).phase, "upload-cancelled");
  assert.equal(store.get(record.id).uploadApproval, null);
});

test("a competing start cannot replace the baseline of the approved upload", async (t) => {
  const { root, store, record } = await association(t);
  let ready;
  const prompt = new Promise((resolve) => {
    ready = resolve;
  });
  const firstIO = terminal(() => ready());
  const first = captureAndApproveUpload(store, record, firstIO);
  await prompt;
  const firstDigest = store.get(record.id).baselineDigest;
  write(root, "source", "unapproved competing bytes\n");
  const second = captureAndApproveUpload(
    store,
    record,
    terminal((input) => input.end()),
  ).then(
    () => null,
    (error) => error,
  );
  await new Promise((resolve) => setImmediate(resolve));
  firstIO.input.write(`UPLOAD ${firstDigest}\n`);
  const approved = await first;
  assert.equal((await second).code, "upload_already_reviewed");
  assert.equal(store.get(record.id).baselineDigest, approved.digest);
  assert.equal(
    readSnapshot(store.get(record.id).baseline).digest,
    approved.digest,
  );
});
