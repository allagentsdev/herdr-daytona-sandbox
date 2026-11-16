import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";
import { resolveGitContext, parsePluginContext } from "../src/context.mjs";
import { repository, temporary } from "./helpers.mjs";
test("checkout context wins and escaping focused symlinks fail", (t) => {
  const root = repository(t),
    outside = temporary(t);
  fs.mkdirSync(path.join(root, "sub"));
  assert.equal(
    resolveGitContext({
      worktree: { checkout_path: root },
      focused_pane_cwd: outside,
    }).root,
    root,
  );
  assert.equal(
    resolveGitContext({
      worktree: { checkout_path: root },
      focused_pane_cwd: path.join(root, "sub"),
    }).relativeCwd,
    "sub",
  );
  fs.symlinkSync(outside, path.join(root, "escape"));
  assert.throws(() =>
    resolveGitContext({
      worktree: { checkout_path: root },
      focused_pane_cwd: path.join(root, "escape"),
    }),
  );
  assert.throws(() => resolveGitContext({}), {
    code: "missing_worktree_context",
  });
  assert.throws(() => parsePluginContext("[]"));
});
