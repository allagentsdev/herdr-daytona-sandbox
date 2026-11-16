#!/usr/bin/env node
import { Store } from "./state.mjs";
import { worktreeRemoved } from "./actions.mjs";
import { emitResult, emitFailure } from "./result.mjs";
try {
  const r = await worktreeRemoved(
    new Store(),
    JSON.parse(process.env.HERDR_PLUGIN_EVENT_JSON ?? "{}"),
  );
  emitResult("worktree.removed", r.status, r);
} catch (e) {
  emitFailure("worktree.removed", e);
  process.exitCode = 1;
}
