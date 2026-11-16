import fs from "node:fs";
import { randomUUID } from "node:crypto";
import { ACTIONS } from "./constants.mjs";
import { loadConfig, managementAuth, agentEnvironment } from "./config.mjs";
import { parsePluginContext, resolveGitContext } from "./context.mjs";
import { Store, namespace } from "./state.mjs";
import { openPluginPane } from "./herdr.mjs";
import { getAdapter } from "./adapters.mjs";
import { DaytonaProvider } from "./sandbox.mjs";
import { PluginError } from "./result.mjs";

export function selectAssociation(store, context, env = process.env, explicit) {
  const scope = namespace(env);
  if (explicit) {
    const r = store.get(explicit);
    if (r.namespace !== scope)
      throw new PluginError(
        "association_scope",
        "Association belongs to another Herdr server/session.",
      );
    return r;
  }
  const pane = context.focused_pane_id ?? env.HERDR_PANE_ID;
  const matches = store
    .list()
    .filter(
      (r) =>
        r.namespace === scope &&
        r.remotePaneId === pane &&
        (!context.workspace_id || r.workspaceId === context.workspace_id) &&
        r.phase !== "deleted",
    );
  if (matches.length > 1)
    throw new PluginError(
      "association_ambiguous",
      "Several associations match this pane; select an explicit association.",
    );
  return matches[0] ?? null;
}
export function candidates(store, context, env = process.env) {
  const scope = namespace(env);
  let root;
  try {
    root = resolveGitContext(context).root;
  } catch {
    root = context.worktree?.checkout_path ?? context.workspace_cwd;
  }
  return store
    .list()
    .filter(
      (r) =>
        r.namespace === scope &&
        r.phase !== "deleted" &&
        (!root || r.localRoot === root),
    );
}
export async function runAction(action, args = {}, options = {}) {
  if (!ACTIONS.includes(action))
    throw new PluginError("unknown_action", "Unknown plugin action.");
  const env = options.env ?? process.env,
    store = options.store ?? new Store(env.HERDR_PLUGIN_STATE_DIR);
  const context =
    options.context ??
    parsePluginContext(
      env.DAYTONA_SOURCE_CONTEXT ?? env.HERDR_PLUGIN_CONTEXT_JSON,
    );
  const openPane = options.openPane ?? openPluginPane;
  const paneOptions = {
    placement: "popup",
    focus: true,
    processEnv: env,
    env: {
      DAYTONA_SOURCE_CONTEXT: JSON.stringify(context),
      DAYTONA_OPERATION: action,
    },
  };
  if (action === "start-agent") {
    const config = loadConfig(env);
    managementAuth(config, env);
    agentEnvironment(config, env);
    const git = resolveGitContext(context);
    const id = randomUUID(),
      stat = fs.statSync(git.root);
    const r = await store.create({
      id,
      namespace: namespace(env),
      localRoot: git.root,
      localCwd: git.cwd,
      relativeCwd: git.relativeCwd,
      sourcePaneId: git.sourcePaneId,
      remotePaneId: null,
      workspaceId: context.workspace_id ?? env.HERDR_WORKSPACE_ID ?? null,
      rootIdentity: { dev: stat.dev, ino: stat.ino },
      phase: "provisional",
      sandboxId: null,
      config,
    });
    try {
      openPane("start", context, {
        ...paneOptions,
        placement: "split",
        targetPaneId: r.sourcePaneId,
        cwd: r.localCwd,
        focus: false,
        env: {
          ...paneOptions.env,
          DAYTONA_ASSOCIATION: id,
          HERDR_AGENT: getAdapter(config.agent).detection,
        },
      });
    } catch (e) {
      await store.update(id, (v) => ({ ...v, phase: "pane-failed" }));
      throw e;
    }
    return { status: "opened", association: id };
  }
  const r = selectAssociation(store, context, env, args.association);
  if (args.exportOnly) {
    if (action !== "apply-changes" || !r)
      throw new PluginError(
        "review_required",
        "Export requires an explicit association.",
      );
    const provider = await DaytonaProvider.connect(r.config, store, env);
    const { preparePatch } = await import("./patch.mjs");
    return preparePatch(store, r.id, provider);
  }
  if (args.approve) {
    if (action !== "apply-changes" || !r || !args.artifact || !args.digest)
      throw new PluginError(
        "review_required",
        "Approval requires an association, exact artifact ID, and digest.",
      );
    const { applyReviewedPatch } = await import("./patch.mjs");
    return applyReviewedPatch(store, r.id, args.artifact, args.digest);
  }
  if (args.confirmDelete) {
    if (action !== "delete-sandbox" || !r)
      throw new PluginError(
        "deletion_confirmation",
        "Select an association and name its sandbox for deletion.",
      );
    const provider = await DaytonaProvider.connect(r.config, store, env);
    return deleteAssociation(store, r.id, args.confirmDelete, provider);
  }
  if (!r && action !== "status") {
    openPane("operation", context, {
      ...paneOptions,
      env: {
        ...paneOptions.env,
        DAYTONA_OPERATION: "select",
        DAYTONA_NEXT_ACTION: action,
      },
    });
    return { status: "selection_required" };
  }
  if (action === "reconnect") {
    openPane("agent", context, {
      ...paneOptions,
      placement: "split",
      targetPaneId: context.focused_pane_id ?? env.HERDR_PANE_ID,
      cwd: fs.existsSync(r.localCwd) ? r.localCwd : undefined,
      focus: false,
      env: {
        ...paneOptions.env,
        DAYTONA_ASSOCIATION: r.id,
        HERDR_AGENT: getAdapter(r.config.agent).detection,
      },
    });
  } else {
    openPane(
      action === "delete-sandbox" ? "confirmation" : "operation",
      context,
      {
        ...paneOptions,
        env: {
          ...paneOptions.env,
          ...(r ? { DAYTONA_ASSOCIATION: r.id } : {}),
        },
      },
    );
  }
  return { status: "opened", association: r?.id ?? null };
}
export async function deleteAssociation(store, id, confirmation, provider) {
  return store.withLock(id, async () => {
    const r = store.get(id);
    if (!r.sandboxId || confirmation !== r.sandboxId)
      throw new PluginError(
        "deletion_confirmation",
        "Confirmation must exactly name the recorded sandbox.",
      );
    await store.update(id, (v) => ({ ...v, phase: "deleting" }));
    const box = await provider.get(r.sandboxId);
    if (box && box.state !== "destroyed") await provider.delete(box);
    await store.update(id, (v) => ({
      ...v,
      phase: "deleted",
      deletedAt: new Date().toISOString(),
      remotePaneId: null,
    }));
    return { status: "deleted", association: id, sandboxId: r.sandboxId };
  });
}
export async function worktreeRemoved(
  store,
  event,
  env = process.env,
  openPane = openPluginPane,
) {
  const data = event.data;
  const scope = namespace(env);
  if (
    data?.type !== "worktree_removed" ||
    typeof data.worktree?.path !== "string"
  )
    throw new PluginError(
      "invalid_event",
      "Expected the worktree.removed event with its exact worktree path.",
    );
  const matches = store
    .list()
    .filter(
      (r) =>
        r.namespace === scope &&
        r.localRoot === data.worktree.path &&
        r.workspaceId === data.workspace_id &&
        r.phase !== "deleted",
    );
  for (const r of matches) {
    await store.update(r.id, (v) => ({ ...v, orphaned: true }));
    if (r.config.onWorktreeRemoved === "confirm-delete") {
      // A busy/missing UI must leave the orphan retained, never bypass confirmation.
      try {
        openPane(
          "confirmation",
          {},
          {
            placement: "popup",
            processEnv: env,
            env: { DAYTONA_ASSOCIATION: r.id },
          },
        );
      } catch {
        continue;
      }
    }
  }
  return { status: "retained", associations: matches.map((r) => r.id) };
}
