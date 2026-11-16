import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { DaytonaProvider, provision } from "../src/sandbox.mjs";
import { Store } from "../src/state.mjs";
import { validateConfig } from "../src/config.mjs";
import { captureSnapshot } from "../src/manifest.mjs";
import { repository, temporary, write } from "./helpers.mjs";
import { getAdapter } from "../src/adapters.mjs";
import { runSync } from "../src/process.mjs";

test("provider creates persistent EU sandbox using the exact stable SDK shape", async () => {
  let params, opts;
  const p = new DaytonaProvider(
    {
      create: async (a, b) => {
        params = a;
        opts = b;
        return { id: "sandbox" };
      },
    },
    validateConfig({}),
  );
  await p.create({ id: "op" });
  assert.equal(params.autoStopInterval, 15);
  assert.equal(params.autoDeleteInterval, -1);
  assert.equal(params.ttlMinutes, 0);
  assert.equal(params.ephemeral, false);
  assert.equal(params.target, "eu");
  assert.equal(params.labels["herdr-operation"], "op");
  assert.equal(opts.timeout, 300);
  assert.equal(params.envVars, undefined);
});

test("real preparation orchestration transfers bytes/modes and creates an empty invoking cwd for every adapter", async (t) => {
  for (const agent of ["codex", "claude-code", "opencode", "pi"]) {
    const root = repository(t),
      store = new Store(temporary(t)),
      id = randomUUID(),
      config = validateConfig({ agent }),
      adapter = getAdapter(agent);
    write(root, "script", "#!/bin/sh\nexit 0\n", 0o755);
    write(root, "binary", Buffer.from([0, 255, 127]));
    fs.mkdirSync(path.join(root, "empty cwd"));
    const snapshot = captureSnapshot(
      root,
      config,
      path.join(store.artifacts(id), "baseline"),
    );
    await store.create({
      id,
      namespace: "n",
      localRoot: root,
      relativeCwd: "empty cwd",
      config,
      phase: "provisional",
      baseline: snapshot.directory,
      baselineDigest: snapshot.digest,
    });
    const remote = temporary(t),
      workspace = path.join(remote, "workspace"),
      bin = path.join(remote, "bin");
    fs.mkdirSync(bin);
    const map = (p) => p.replace(config.remoteRoot, workspace);
    let installs = 0;
    const box = {
      id: `box-${agent}`,
      state: "started",
      fs: {
        uploadFile: async (local, dest) => fs.copyFileSync(local, map(dest)),
        setFilePermissions: async (p, permissions) =>
          fs.chmodSync(map(p), Number.parseInt(permissions.mode, 8)),
      },
      process: {
        executeCommand: async (command, cwd) => {
          if (command.startsWith("npm install --global ")) {
            assert.ok(command.includes(adapter.package));
            installs++;
            write(
              bin,
              adapter.binary,
              `#!/bin/sh\nprintf '%s\\n' '${adapter.version}'\n`,
              0o755,
            );
            return { exitCode: 0, result: "" };
          }
          const result = runSync(
            "bash",
            [
              "--noprofile",
              "--norc",
              "-c",
              command.replaceAll(config.remoteRoot, workspace),
            ],
            {
              cwd: map(cwd),
              env: {
                PATH: `${bin}:${path.dirname(process.execPath)}:${process.env.PATH}`,
                GIT_CONFIG_GLOBAL: "/dev/null",
                GIT_CONFIG_NOSYSTEM: "1",
              },
              check: false,
            },
          );
          return { exitCode: result.status, result: result.stdout };
        },
      },
    };
    const provider = new DaytonaProvider({ create: async () => box }, config);
    const ready = await provision(store, id, provider);
    assert.equal(ready.phase, "ready");
    assert.equal(ready.installedVersion, adapter.version);
    assert.equal(installs, 1);
    assert.deepEqual(
      fs.readFileSync(path.join(workspace, "binary")),
      Buffer.from([0, 255, 127]),
    );
    assert.ok(fs.statSync(path.join(workspace, "script")).mode & 0o111);
    assert.ok(fs.statSync(path.join(workspace, "empty cwd")).isDirectory());
    assert.ok(fs.existsSync(path.join(workspace, ".git", "HEAD")));
    assert.equal(ready.checkpoint, snapshot.directory);
  }
});
test("creation ID is durable before setup fails; retry never allocates another sandbox", async (t) => {
  const store = new Store(temporary(t)),
    root = repository(t),
    id = randomUUID(),
    config = validateConfig({});
  write(root, "a", "local dirty baseline");
  const snapshot = captureSnapshot(
    root,
    config,
    `${store.artifacts(id)}/baseline`,
  );
  await store.create({
    id,
    namespace: "ns",
    localRoot: root,
    relativeCwd: ".",
    config,
    phase: "provisional",
    baseline: snapshot.directory,
    baselineDigest: snapshot.digest,
  });
  let creates = 0;
  const provider = {
    create: async () => {
      creates++;
      return { id: "persisted" };
    },
    get: async () => ({ id: "persisted" }),
    prepare: async () => {
      assert.equal(store.get(id).sandboxId, "persisted");
      throw new Error("secret must not appear");
    },
  };
  await assert.rejects(provision(store, id, provider));
  assert.equal(store.get(id).phase, "failed");
  assert.equal(store.get(id).sandboxId, "persisted");
  assert.doesNotMatch(JSON.stringify(store.get(id)), /secret must not appear/);
  await assert.rejects(provision(store, id, provider));
  assert.equal(creates, 1);
});
test("uncertain creates reconcile exact labels, without blind recreation", async (t) => {
  const store = new Store(temporary(t)),
    id = randomUUID(),
    config = validateConfig({});
  await store.create({
    id,
    namespace: "ns",
    localRoot: "/tmp",
    config,
    phase: "creating",
    creationAttempted: true,
  });
  let created = false;
  const provider = {
    reconcile: async () => null,
    create: async () => {
      created = true;
    },
  };
  await assert.rejects(provision(store, id, provider), {
    code: "creation_uncertain",
  });
  assert.equal(created, false);
  assert.equal(store.get(id).phase, "creation-uncertain");
});
