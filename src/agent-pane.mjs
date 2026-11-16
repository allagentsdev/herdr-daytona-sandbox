#!/usr/bin/env node
import { DaytonaProvider, provision } from "./sandbox.mjs";
import { attachAgent } from "./terminal.mjs";
import { paneAssociation, runPane } from "./pane-runtime.mjs";
import { show } from "./terminal-ui.mjs";
await runPane("reconnect", async () => {
  const { store, record: r } = paneAssociation();
  const provider = await DaytonaProvider.connect(r.config, store);
  if (!r.sandboxId && r.creationAttempted)
    await provision(store, r.id, provider, show);
  show(
    `Reconnecting association ${r.id} to ${store.get(r.id).sandboxId ?? "unresolved sandbox"}...`,
  );
  await attachAgent(store, r.id, provider);
});
