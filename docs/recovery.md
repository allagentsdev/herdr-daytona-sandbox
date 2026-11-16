# Review artifacts and recovery

[Back to the README](../README.md)

Herdr supplies `HERDR_PLUGIN_STATE_DIR`. Private association JSON files and
baseline/review artifacts live there with owner-only permissions, outside the
worktree. Associations include the server/session namespace, worktree identity,
sandbox/PTY IDs, region/config, phases, and content digests. Keep these files to
recover orphaned sandboxes and incremental patch checkpoints.

For automation, run from the same Herdr server/session environment, with
`HERDR_PLUGIN_CONFIG_DIR` and `HERDR_PLUGIN_STATE_DIR` set to their supplied
directories. Export and review without approving:

```sh
node /path/to/plugin/src/action.mjs apply-changes \
  --association <association-id> --export-only
```

The `DAYTONA_RESULT` record identifies `artifact`, `digest`, `patchPath`, changed
paths, and destination. Inspect that saved patch, then separately approve those
exact bytes:

```sh
node /path/to/plugin/src/action.mjs apply-changes \
  --association <association-id> --artifact <artifact-id> \
  --digest <sha256> --approve
```

Direct deletion requires `delete-sandbox --association <id> --confirm-delete
<sandbox-id>`. Omitted input or a generic yes flag never approves anything.

If creation times out, the provisional operation label `herdr-operation=<id>`
and association are retained. Reconnect reconciles that exact label before any
further action. An unresolved request never triggers blind recreation. A later
setup failure retains the sandbox ID and phase; inspect it in Daytona, then
delete or recover manually. Reconnect deliberately refuses to overwrite a
partially prepared workspace. If an initial PTY launch was uncertain, it attaches
without resending the command and reports that uncertainty.

An approved apply saves private snapshots of the changed local files before and
after the checked patch. This preserves new non-overlapping local edits while
keeping the remote checkpoint separate. If files applied but the checkpoint
write failed, a later apply reconciles the recorded local result without
replaying it. If interruption happened before writing, unchanged local files
allow a checked retry. A partial or divergent mismatch requires inspection of
the retained artifact. Never delete a baseline/checkpoint to force an apply.

If a previously uploaded/checkpoint file becomes excluded remotely (for example,
it becomes a symlink or contains detected secret material), export stops instead
of presenting it as a deletion. Inspect the remote file before retrying.

Locks serialize actions on one association. A dead process's lock is recovered
on retry under a separate recovery lock, with its owner checked again. If a
malformed lock or abandoned `.lock.recovery` remains, inspect the recorded PIDs
and remove only that association's lock after confirming no action is running. State may
contain private source; remove local artifacts only after remote cleanup and
when you no longer need recovery. No background orphan collector runs.
