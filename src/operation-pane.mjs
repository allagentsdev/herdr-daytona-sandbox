#!/usr/bin/env node
import fs from "node:fs";
import { candidates, runAction, stopAssociation } from "./actions.mjs";
import { getAdapter } from "./adapters.mjs";
import { parsePluginContext } from "./context.mjs";
import { Store } from "./state.mjs";
import { DaytonaProvider } from "./sandbox.mjs";
import { paneAssociation, runPane } from "./pane-runtime.mjs";
import { show, question, review, dismiss } from "./terminal-ui.mjs";
import { errorMessage, emitResult } from "./result.mjs";
import { confirmDeletion } from "./deletion-ui.mjs";

await runPane(process.env.DAYTONA_OPERATION ?? "status", async () => {
  const store = new Store(),
    context = parsePluginContext(
      process.env.DAYTONA_SOURCE_CONTEXT ??
        process.env.HERDR_PLUGIN_CONTEXT_JSON,
    );
  let operation = process.env.DAYTONA_OPERATION;
  if (operation === "select") {
    const list = candidates(store, context);
    show(
      `Retained associations for this worktree:\n${list.map((r, i) => `${i + 1}. ${r.id} | ${r.config.agent} | ${r.sandboxId ?? "creation unresolved"} | ${r.phase}`).join("\n")}`,
    );
    if (!list.length) {
      await dismiss();
      return;
    }
    const answer = await question("Association number (Enter cancels) > ");
    if (!/^[1-9]\d*$/.test(answer) || !list[Number(answer) - 1]) return;
    process.env.DAYTONA_ASSOCIATION = list[Number(answer) - 1].id;
    operation = process.env.DAYTONA_NEXT_ACTION;
    if (operation === "reconnect") {
      await runAction(
        operation,
        { association: process.env.DAYTONA_ASSOCIATION },
        { store, context },
      );
      return;
    }
  }
  if (
    ["delete-sandbox", "replace-sandbox", "forget-mapping"].includes(operation)
  ) {
    await confirmDeletion(store, paneAssociation(store).record, {
      operation,
      context,
    });
    return;
  }
  if (operation === "stop") {
    const { record: r } = paneAssociation(store);
    const provider = await DaytonaProvider.connect(r.config, store);
    const result = await stopAssociation(store, r.id, provider);
    emitResult("stop", result.status, result);
    show(
      "Compute stopped. Sandbox files and recovery metadata are retained; reconnect starts the agent again.",
    );
    await dismiss();
    return;
  }
  if (operation === "apply-changes") {
    const { record: r } = paneAssociation(store);
    const provider = await DaytonaProvider.connect(r.config, store);
    const { preparePatch, applyReviewedPatch, reviewText } = await import(
      "./patch.mjs"
    );
    const candidate = await preparePatch(store, r.id, provider);
    emitResult("apply-changes", candidate.status, candidate);
    if (candidate.status === "no_change") {
      show("No remote changes since the last applied checkpoint.");
      await dismiss();
      return;
    }
    if (await review(reviewText(candidate)))
      emitResult(
        "apply-changes",
        "applied",
        await applyReviewedPatch(
          store,
          r.id,
          candidate.artifact,
          candidate.digest,
        ),
      );
    else show("Cancelled. Local files and checkpoint unchanged.");
    return;
  }
  const list = process.env.DAYTONA_ASSOCIATION
    ? [paneAssociation(store).record]
    : candidates(store, context);
  for (const r of list) {
    const adapter = getAdapter(r.config.agent, r.config);
    let state = "unknown";
    try {
      const p = await DaytonaProvider.connect(r.config, store);
      const s = r.sandboxId
        ? await p.get(r.sandboxId)
        : await p.reconcile(r.id);
      state =
        s?.state ??
        (r.sandboxId
          ? "missing"
          : r.creationAttempted
            ? "creation unresolved"
            : "not created");
    } catch (e) {
      state = errorMessage(e);
    }
    show(
      `Association: ${r.id}\nSandbox: ${r.sandboxId ?? "unresolved"}\nAgent/version: ${r.config.agent} ${r.installedVersion ?? "unverified"}\nAdapter: ${adapter.supportLevel ?? "pinned builtin; see verification record"}\nAuthentication: ${adapter.authenticationMode ?? "agent-managed"}\nTTY/resume: ${adapter.interactiveTTY ?? true}/${adapter.resumeSupported ?? true}\nLocal: ${r.localRoot} (${fs.existsSync(r.localRoot) ? "present" : "missing"})\nPhase: ${r.phase}\nProvider: ${state}\nPane: ${r.remotePaneId ?? "none"} (last associated; may be disconnected)\nOrphaned: ${Boolean(r.orphaned)}\nLast error: ${r.lastError ?? "none"}\n`,
    );
  }
  if (!list.length) show("No retained associations for this context.");
  await dismiss();
});
