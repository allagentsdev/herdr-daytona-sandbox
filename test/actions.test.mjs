import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import {
  runAction,
  selectAssociation,
  worktreeRemoved,
} from "../src/actions.mjs";
import { Store, namespace } from "../src/state.mjs";
import { validateConfig } from "../src/config.mjs";
import { repository, temporary } from "./helpers.mjs";

test("start validates before opening a progress pane and captures source context", async (t) => {
  const root = repository(t),
    dir = temporary(t),
    store = new Store(path.join(dir, "state"));
  const context = {
    worktree: { checkout_path: root },
    focused_pane_id: "w1:p1",
    workspace_id: "w1",
  };
  const env = { HERDR_SOCKET_PATH: "/isolated", HERDR_PLUGIN_CONFIG_DIR: dir };
  let opened;
  await assert.rejects(
    runAction(
      "start-agent",
      {},
      {
        env,
        store,
        context,
        openPane: () => {
          throw Error("must not open");
        },
      },
    ),
    { code: "missing_auth" },
  );
  const result = await runAction(
    "start-agent",
    {},
    {
      env: { ...env, DAYTONA_API_KEY: "fixture-control-key-not-for-state" },
      store,
      context,
      openPane: (...args) => {
        opened = args;
      },
    },
  );
  assert.equal(opened[0], "start");
  assert.equal(opened[2].focus, false);
  assert.equal(opened[2].targetPaneId, "w1:p1");
  assert.equal(store.get(result.association).localRoot, root);
  assert.doesNotMatch(
    JSON.stringify(store.list()),
    /fixture-control-key-not-for-state/,
  );
});
test("unassociated reconnect requires selection, even for one retained record", async (t) => {
  const store = new Store(temporary(t)),
    root = repository(t),
    id = randomUUID(),
    env = { HERDR_SOCKET_PATH: "/isolated" };
  await store.create({
    id,
    namespace: namespace(env),
    localRoot: root,
    remotePaneId: "w1:closed",
    workspaceId: "w1",
    phase: "detached",
    config: validateConfig({}),
  });
  const context = {
    focused_pane_id: "w1:p2",
    workspace_id: "w1",
    workspace_cwd: root,
  };
  assert.equal(selectAssociation(store, context, env), null);
  let opened;
  await runAction(
    "reconnect",
    {},
    {
      store,
      env,
      context,
      openPane: (...args) => {
        opened = args;
      },
    },
  );
  assert.equal(opened[0], "operation");
  assert.equal(opened[2].env.DAYTONA_OPERATION, "select");
  assert.equal(
    selectAssociation(store, { ...context, focused_pane_id: "w1:closed" }, env)
      .id,
    id,
  );
  assert.throws(
    () =>
      selectAssociation(store, context, { HERDR_SOCKET_PATH: "/other" }, id),
    { code: "association_scope" },
  );
});
test("worktree removal matches exact event path and retains resources", async (t) => {
  const dir = temporary(t),
    store = new Store(dir),
    env = { HERDR_SOCKET_PATH: "/isolation" },
    id = randomUUID();
  await store.create({
    id,
    namespace: namespace(env),
    localRoot: "/gone/tree",
    workspaceId: "w1",
    sandboxId: "retained",
    config: validateConfig({}),
    phase: "ready",
  });
  await worktreeRemoved(
    store,
    {
      data: {
        type: "worktree_removed",
        workspace_id: "w1",
        worktree: { path: "/gone/tree" },
      },
    },
    env,
    () => {
      throw Error("must not delete");
    },
  );
  assert.equal(store.get(id).orphaned, true);
  assert.equal(store.get(id).sandboxId, "retained");
  assert.ok(fs.existsSync(store.file(id)));
});
