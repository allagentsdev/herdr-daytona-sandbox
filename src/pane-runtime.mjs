import { Store } from "./state.mjs";
import { selectAssociation } from "./actions.mjs";
import { parsePluginContext } from "./context.mjs";
import { emitFailure } from "./result.mjs";
import { dismiss } from "./terminal-ui.mjs";

export function paneAssociation(store = new Store()) {
  const r = selectAssociation(
    store,
    parsePluginContext(),
    process.env,
    process.env.DAYTONA_ASSOCIATION,
  );
  if (!r) throw Error("Missing captured association");
  return { store, record: r };
}
export async function runPane(action, fn) {
  try {
    await fn();
  } catch (e) {
    emitFailure(action, e);
    await dismiss();
    process.exitCode =
      Number.isInteger(e.exitCode) && e.exitCode > 0 && e.exitCode <= 255
        ? e.exitCode
        : 1;
  }
}
