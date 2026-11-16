#!/usr/bin/env node
import { paneAssociation, runPane } from "./pane-runtime.mjs";
import { confirmDeletion } from "./deletion-ui.mjs";
await runPane("delete-sandbox", async () => {
  const { store, record: r } = paneAssociation();
  await confirmDeletion(store, r);
});
