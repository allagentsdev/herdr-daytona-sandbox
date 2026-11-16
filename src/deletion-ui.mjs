import {
  deleteAssociation,
  replaceAssociation,
  forgetAssociation,
} from "./actions.mjs";
import { DaytonaProvider } from "./sandbox.mjs";
import { show, question } from "./terminal-ui.mjs";
import { emitResult } from "./result.mjs";
export async function confirmDeletion(
  store,
  r,
  { operation = "delete-sandbox", context = {} } = {},
) {
  show(
    `Permanently delete sandbox ${r.sandboxId ?? "(creation unresolved)"}\nAssociation: ${r.id}\nWorktree: ${r.localRoot}\nAll remote files will be lost.`,
  );
  if (operation === "replace-sandbox")
    show(
      "After confirmed deletion, a fresh start pane will ask you to review and approve the new upload.",
    );
  if (operation === "forget-mapping")
    show(
      "After confirmed deletion, this association and its saved local review/recovery artifacts will also be removed. Your Git worktree will remain unchanged.",
    );
  if (!r.sandboxId) {
    show(
      "Resolve the operation label through status/reconnect before deletion.",
    );
    return;
  }
  if (
    (await question(
      `Type DELETE ${r.sandboxId} to confirm (Enter cancels) > `,
    )) !== `DELETE ${r.sandboxId}`
  ) {
    show("Cancelled. Sandbox retained.");
    return;
  }
  const provider = await DaytonaProvider.connect(r.config, store);
  const result =
    operation === "replace-sandbox"
      ? await replaceAssociation(store, r.id, r.sandboxId, {
          provider,
          context,
        })
      : operation === "forget-mapping"
        ? await forgetAssociation(store, r.id, r.sandboxId, provider)
        : await deleteAssociation(store, r.id, r.sandboxId, provider);
  emitResult(operation, result.status, result);
}
