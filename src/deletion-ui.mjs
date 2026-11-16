import { deleteAssociation } from "./actions.mjs";
import { DaytonaProvider } from "./sandbox.mjs";
import { show, question } from "./terminal-ui.mjs";
import { emitResult } from "./result.mjs";
export async function confirmDeletion(store, r) {
  show(
    `Permanently delete sandbox ${r.sandboxId ?? "(creation unresolved)"}\nAssociation: ${r.id}\nWorktree: ${r.localRoot}\nAll remote files will be lost.`,
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
  emitResult(
    "delete-sandbox",
    "deleted",
    await deleteAssociation(store, r.id, r.sandboxId, provider),
  );
}
