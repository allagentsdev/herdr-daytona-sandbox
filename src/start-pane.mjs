#!/usr/bin/env node
import { captureAndApproveUpload } from "./upload-approval.mjs";
import { DaytonaProvider, provision } from "./sandbox.mjs";
import { attachAgent } from "./terminal.mjs";
import { paneAssociation, runPane } from "./pane-runtime.mjs";
import { show } from "./terminal-ui.mjs";

await runPane("start-agent", async () => {
  const { store, record: r } = paneAssociation();
  show(
    `Association: ${r.id}\nAgent: ${r.config.agent}\nRegion: ${r.config.region}\nDestination: ${r.config.remoteRoot}\nCapturing filtered worktree...`,
  );
  await captureAndApproveUpload(store, r);
  await store.update(r.id, (v) => ({
    ...v,
    remotePaneId: process.env.HERDR_PANE_ID ?? null,
  }));
  const provider = await DaytonaProvider.connect(r.config, store);
  await provision(store, r.id, provider, show);
  show(
    "Ready. Closing this pane disconnects transport and retains the sandbox.",
  );
  await attachAgent(store, r.id, provider);
});
