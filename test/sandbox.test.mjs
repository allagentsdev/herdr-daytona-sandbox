import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { DaytonaProvider, provision } from "../src/sandbox.mjs";
import { Store } from "../src/state.mjs";
import { validateConfig } from "../src/config.mjs";
import { captureSnapshot } from "../src/manifest.mjs";
import { repository, temporary, write } from "./helpers.mjs";

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
