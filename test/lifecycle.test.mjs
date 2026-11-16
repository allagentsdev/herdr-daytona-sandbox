import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Store } from "../src/state.mjs";
import { deleteAssociation } from "../src/actions.mjs";
import { validateConfig } from "../src/config.mjs";
import { temporary } from "./helpers.mjs";
test("deletion requires exact identity, keeps recovery data on failure and marks only confirmed absence", async (t) => {
  const store = new Store(temporary(t)),
    id = randomUUID();
  await store.create({
    id,
    namespace: "n",
    localRoot: "/gone",
    sandboxId: "box-exact",
    phase: "ready",
    config: validateConfig({}),
  });
  let calls = 0;
  const p = {
    get: async () => ({ id: "box-exact", state: "started" }),
    delete: async () => {
      calls++;
      throw Error("uncertain");
    },
  };
  await assert.rejects(deleteAssociation(store, id, "yes", p), {
    code: "deletion_confirmation",
  });
  assert.equal(calls, 0);
  await assert.rejects(deleteAssociation(store, id, "box-exact", p));
  assert.equal(store.get(id).phase, "deleting");
  assert.equal(store.get(id).sandboxId, "box-exact");
  p.get = async () => null;
  await deleteAssociation(store, id, "box-exact", p);
  assert.equal(store.get(id).phase, "deleted");
  assert.equal(store.get(id).sandboxId, "box-exact");
});
