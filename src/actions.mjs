import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { ACTIONS } from "./constants.mjs";
import { loadConfig, managementAuth, agentEnvironment } from "./config.mjs";
import { parsePluginContext, resolveGitContext } from "./context.mjs";
import { Store, namespace } from "./state.mjs";
import { openPluginPane } from "./herdr.mjs";
import { getAdapter } from "./adapters.mjs";
import { DaytonaProvider, providerCall } from "./sandbox.mjs";
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
  if (action === "info") action = "status";
  if (action === "connect-daytona") {
    openPane("connect", context, { ...paneOptions, env: {} });
    return { status: "opened" };
  }
  if (action === "start-agent") {
    const config = loadConfig(env);
    try {
      managementAuth(config, env);
    } catch (e) {
      if (e.code !== "missing_auth") throw e;
      openPane("connect", context, { ...paneOptions, env: {} });
      return { status: "authentication_required" };
    }
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
        focus: false,
        env: {
          ...paneOptions.env,
          DAYTONA_ASSOCIATION: id,
          HERDR_AGENT: getAdapter(config.agent, config).detection,
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
    if (
      !["delete-sandbox", "replace-sandbox", "forget-mapping"].includes(
        action,
      ) ||
      !r
    )
      throw new PluginError(
        "deletion_confirmation",
        "Select an association and name its sandbox for deletion.",
      );
    const provider = await DaytonaProvider.connect(r.config, store, env);
    if (action === "replace-sandbox")
      return replaceAssociation(store, r.id, args.confirmDelete, {
        ...options,
        store,
        env,
        context,
        provider,
      });
    if (action === "forget-mapping")
      return forgetAssociation(store, r.id, args.confirmDelete, provider);
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
      focus: false,
      env: {
        ...paneOptions.env,
        DAYTONA_ASSOCIATION: r.id,
        HERDR_AGENT: getAdapter(r.config.agent, r.config).detection,
      },
    });
  } else {
    openPane(
      ["delete-sandbox", "replace-sandbox", "forget-mapping"].includes(action)
        ? "confirmation"
        : "operation",
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
  return store.withLock(id, () =>
    deleteLocked(store, id, confirmation, provider),
  );
}
async function deleteLocked(store, id, confirmation, provider) {
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
}
export async function stopAssociation(store, id, provider) {
  return store.withLock(id, async () => {
    const r = store.get(id);
    const previousPhase =
      r.phase === "stopping" ? (r.stopPreviousPhase ?? "failed") : r.phase;
    const prepared = ["ready", "connected", "detached", "stopped"].includes(
      previousPhase,
    );
    if (!r.sandboxId)
      throw new PluginError(
        "provider_missing",
        "No sandbox identity is recorded.",
      );
    const box = await provider.get(r.sandboxId);
    if (!box)
      throw new PluginError(
        "provider_missing",
        "The saved sandbox no longer exists.",
      );
    if (!["started", "stopped", "archived"].includes(box.state))
      throw new PluginError(
        "sandbox_not_ready",
        `Cannot stop sandbox in state ${box.state}. Inspect status before retrying.`,
      );
    if (box.state === "started") {
      await store.update(id, (v) => ({
        ...v,
        phase: "stopping",
        stopPreviousPhase: previousPhase,
      }));
      await providerCall(() => box.stop(r.config.createTimeoutSeconds));
    }
    const after = await provider.get(r.sandboxId);
    if (!after || !["stopped", "archived"].includes(after.state))
      throw new PluginError(
        "stop_uncertain",
        "The provider has not confirmed stopped storage. Recovery metadata is retained.",
      );
    await store.update(id, (v) => ({
      ...v,
      phase: prepared ? "stopped" : previousPhase,
      stopPreviousPhase: null,
      ptyId: null,
      ptyPhase: null,
      lastError: prepared ? null : v.lastError,
    }));
    return {
      status: "stopped",
      association: id,
      sandboxId: r.sandboxId,
      providerState: after.state,
    };
  });
}
export async function replaceAssociation(
  store,
  id,
  confirmation,
  options = {},
) {
  return store.withLock(id, async () => {
    const r = store.get(id),
      env = options.env ?? process.env;
    if (r.phase === "deleted")
      throw new PluginError(
        "already_deleted",
        "This sandbox was already deleted. Use the replacement association or start a new sandbox.",
      );
    if (!r.sandboxId || confirmation !== r.sandboxId)
      throw new PluginError(
        "deletion_confirmation",
        "Confirmation must exactly name the recorded sandbox.",
      );
    const config = loadConfig(env);
    managementAuth(config, env);
    agentEnvironment(config, env);
    const context = {
      ...(options.context ?? {}),
      worktree: { checkout_path: r.localRoot },
      focused_pane_cwd: r.localCwd,
      workspace_id: options.context?.workspace_id ?? r.workspaceId,
    };
    const git = resolveGitContext(context),
      stat = fs.statSync(git.root);
    if (
      git.root !== r.localRoot ||
      stat.dev !== r.rootIdentity?.dev ||
      stat.ino !== r.rootIdentity?.ino
    )
      throw new PluginError(
        "destination_changed",
        "The original local worktree was replaced. The sandbox was retained.",
      );
    const provider =
      options.provider ?? (await DaytonaProvider.connect(r.config, store, env));
    await deleteLocked(store, id, confirmation, provider);
    const next = await runAction(
      "start-agent",
      {},
      { ...options, env, store, context },
    );
    return {
      ...next,
      status: "replacement_opened",
      replacedAssociation: id,
      deletedSandboxId: r.sandboxId,
    };
  });
}
export async function forgetAssociation(store, id, confirmation, provider) {
  return store.withLock(id, async () => {
    const deleted = await deleteLocked(store, id, confirmation, provider);
    if (store.get(id).phase !== "deleted")
      throw new PluginError(
        "deletion_uncertain",
        "Deletion is not confirmed. Recovery metadata is retained.",
      );
    fs.rmSync(path.join(store.directory, id), { recursive: true, force: true });
    fs.unlinkSync(store.file(id));
    return { ...deleted, status: "forgotten" };
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
