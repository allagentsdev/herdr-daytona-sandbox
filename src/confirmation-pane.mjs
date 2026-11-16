#!/usr/bin/env node
import { paneAssociation, runPane } from "./pane-runtime.mjs";
import { confirmDeletion } from "./deletion-ui.mjs";
import { parsePluginContext } from "./context.mjs";
const operation = process.env.DAYTONA_OPERATION ?? "delete-sandbox";
await runPane(operation, async () => {
  const { store, record: r } = paneAssociation();
  await confirmDeletion(store, r, {
    operation,
    context: parsePluginContext(
      process.env.DAYTONA_SOURCE_CONTEXT ??
        process.env.HERDR_PLUGIN_CONTEXT_JSON,
    ),
  });
});
