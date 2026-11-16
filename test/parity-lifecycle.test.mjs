import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { randomUUID } from "node:crypto";
import { Store, namespace, atomicJson } from "../src/state.mjs";
import { validateConfig } from "../src/config.mjs";
import {
  stopAssociation,
  replaceAssociation,
  forgetAssociation,
} from "../src/actions.mjs";
import { repository, temporary } from "./helpers.mjs";

async function association(t) {
  const store = new Store(temporary(t)),
    root = repository(t),
    id = randomUUID();
  const env = {
    HERDR_SOCKET_PATH: "/parity-test",
    HERDR_PLUGIN_CONFIG_DIR: temporary(t),
    DAYTONA_API_KEY: "fixture-control-key",
  };
  const stat = fs.statSync(root);
  await store.create({
    id,
    namespace: namespace(env),
    localRoot: root,
    localCwd: root,
    relativeCwd: ".",
    rootIdentity: { dev: stat.dev, ino: stat.ino },
    workspaceId: "w1",
    sourcePaneId: "w1:p1",
    remotePaneId: "w1:p2",
    sandboxId: "exact-box",
    phase: "ready",
    baseline: "retained-baseline",
    ptyId: "old-pty",
    config: validateConfig({}),
  });
  return {
    store,
    root,
    id,
    env,
    context: {
      workspace_id: "w1",
      focused_pane_id: "w1:p1",
      workspace_cwd: root,
    },
  };
}

test("manual stop preserves recovery state and requires confirmed provider stop", async (t) => {
  const { store, id } = await association(t);
  let stops = 0;
  const box = {
    id: "exact-box",
    state: "started",
    stop: async () => {
      stops++;
      box.state = "stopped";
    },
  };
  const provider = { get: async () => box };
  assert.equal((await stopAssociation(store, id, provider)).status, "stopped");
  assert.equal(stops, 1);
  const saved = store.get(id);
  assert.equal(saved.sandboxId, "exact-box");
  assert.equal(saved.baseline, "retained-baseline");
  assert.equal(saved.phase, "stopped");
  assert.equal(saved.ptyId, null);
  await stopAssociation(store, id, provider);
  assert.equal(stops, 1);
  box.state = "started";
  box.stop = async () => {
    throw Error("uncertain stop");
  };
  await assert.rejects(stopAssociation(store, id, provider));
  assert.equal(store.get(id).phase, "stopping");
  assert.equal(store.get(id).sandboxId, "exact-box");
});

test("replacement validates before deletion and creates a fresh reviewed start only after confirmed deletion", async (t) => {
  const { store, id, env, context } = await association(t);
  let deleted = false,
    opened;
  const provider = {
    get: async () => ({ id: "exact-box", state: "started" }),
    delete: async () => {
      deleted = true;
    },
  };
  const options = {
    env,
    context,
    provider,
    openPane: (...args) => {
      assert.equal(deleted, true);
      opened = args;
    },
  };
  await assert.rejects(replaceAssociation(store, id, "wrong-box", options), {
    code: "deletion_confirmation",
  });
  assert.equal(deleted, false);
  await assert.rejects(
    replaceAssociation(store, id, "exact-box", {
      ...options,
      env: { ...env, DAYTONA_API_KEY: "" },
    }),
    { code: "missing_auth" },
  );
  assert.equal(deleted, false);
  const result = await replaceAssociation(store, id, "exact-box", options);
  assert.equal(store.get(id).phase, "deleted");
  assert.notEqual(result.association, id);
  assert.equal(store.get(result.association).sandboxId, null);
  assert.equal(opened[0], "start");
  assert.equal(opened[2].targetPaneId, "w1:p1");
  await assert.rejects(replaceAssociation(store, id, "exact-box", options), {
    code: "already_deleted",
  });
});

test("forget removes only confirmed-deleted association and its recovery artifacts", async (t) => {
  const { store, id } = await association(t);
  const artifacts = store.artifacts(id);
  fs.writeFileSync(artifacts + "/saved-review", "patch");
  const provider = {
    get: async () => ({ state: "started" }),
    delete: async () => {
      throw Error("uncertain delete");
    },
  };
  await assert.rejects(forgetAssociation(store, id, "exact-box", provider));
  assert.ok(fs.existsSync(store.file(id)));
  assert.ok(fs.existsSync(artifacts));
  provider.get = async () => null;
  assert.equal(
    (await forgetAssociation(store, id, "exact-box", provider)).status,
    "forgotten",
  );
  assert.equal(fs.existsSync(store.file(id)), false);
  assert.equal(fs.existsSync(artifacts), false);
});

test("stopping interrupted setup does not make an unprepared workspace reconnectable", async (t) => {
  const { store, id } = await association(t);
  await store.update(id, (v) => ({
    ...v,
    phase: "failed",
    lastError: "Agent installation failed.",
  }));
  const box = {
    state: "started",
    stop: async () => {
      box.state = "stopped";
    },
  };
  await stopAssociation(store, id, { get: async () => box });
  assert.equal(store.get(id).phase, "failed");
  assert.equal(store.get(id).lastError, "Agent installation failed.");
});

test("forget waits for an existing state writer before removing its association", async (t) => {
  const { store, id } = await association(t);
  let release, signal, writer;
  const blocked = new Promise((resolve) => {
    release = resolve;
  });
  const locked = new Promise((resolve) => {
    signal = resolve;
  });
  const update = store.update.bind(store);
  store.update = async (...args) => {
    const record = await update(...args);
    if (record.phase === "deleted") {
      writer = store.withLock(
        id,
        async () => {
          signal();
          await blocked;
          atomicJson(store.file(id), record);
        },
        { suffix: "state" },
      );
      await locked;
    }
    return record;
  };
  const forgetting = forgetAssociation(store, id, "exact-box", {
    get: async () => null,
  });
  await locked;
  await new Promise((resolve) => setImmediate(resolve));
  const presentWhileWriting = fs.existsSync(store.file(id));
  release();
  await writer;
  await forgetting;
  assert.equal(presentWhileWriting, true);
  assert.equal(fs.existsSync(store.file(id)), false);
});

test("uncertain stop retry preserves whether setup was prepared", async (t) => {
  for (const phase of ["ready", "failed"]) {
    const { store, id } = await association(t);
    await store.update(id, (v) => ({
      ...v,
      phase,
      lastError: "Original setup failure.",
    }));
    const box = {
      state: "started",
      stop: async () => {
        box.state = "stopped";
        throw Error("lost response");
      },
    };
    const provider = { get: async () => box };
    await assert.rejects(stopAssociation(store, id, provider));
    assert.equal(store.get(id).phase, "stopping");
    await stopAssociation(store, id, provider);
    assert.equal(store.get(id).phase, phase === "ready" ? "stopped" : "failed");
    assert.equal(
      store.get(id).lastError,
      phase === "ready" ? null : "Original setup failure.",
    );
  }
});
