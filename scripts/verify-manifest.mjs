import fs from "node:fs";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import TOML from "@iarna/toml";
import { ACTIONS } from "../src/constants.mjs";
const root = fileURLToPath(new URL("../", import.meta.url));
const manifest = TOML.parse(
  fs.readFileSync(path.join(root, "herdr-plugin.toml"), "utf8"),
);
assert.equal(manifest.id, "daytona.sandbox");
assert.equal(manifest.min_herdr_version, "0.8.0");
assert.deepEqual([...manifest.platforms].sort(), ["linux", "macos"]);
assert.deepEqual(manifest.actions.map((a) => a.id).sort(), [...ACTIONS].sort());
assert.deepEqual(manifest.build, [{ command: ["npm", "ci", "--omit=dev"] }]);
assert.deepEqual(manifest.panes.map((p) => p.id).sort(), [
  "agent",
  "confirmation",
  "connect",
  "operation",
  "start",
]);
assert.deepEqual(
  manifest.events.map((e) => e.on),
  ["worktree.removed"],
);
for (const entry of [
  ...manifest.actions,
  ...manifest.panes,
  ...manifest.events,
]) {
  assert.equal(entry.command[0], "node");
  assert.equal(entry.command.length, 2);
  assert.ok(fs.statSync(path.join(root, entry.command[1])).isFile());
}
for (const action of manifest.actions) {
  assert.deepEqual(action.contexts, ["workspace", "pane"]);
  assert.deepEqual(action.command, ["node", "src/action.mjs"]);
}
const pkg = JSON.parse(
  fs.readFileSync(path.join(root, "package.json"), "utf8"),
);
assert.equal(pkg.dependencies["@daytona/sdk"], "0.231.1");
console.log(
  "Manifest: lifecycle actions, five pane entrypoints, retention event, install hook and pinned SDK verified.",
);
