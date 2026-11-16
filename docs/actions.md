# Actions

Run actions from a local shell in the relevant Herdr workspace, or use Herdr's
workspace/pane action picker. The remote agent pane runs inside Daytona; it does
not inherit your local Herdr CLI or shell functions.

Use Herdr's workspace/pane action picker, or:

```sh
herdr plugin action invoke start-agent --plugin daytona.sandbox
herdr plugin action invoke reconnect --plugin daytona.sandbox
herdr plugin action invoke apply-changes --plugin daytona.sandbox
herdr plugin action invoke status --plugin daytona.sandbox
herdr plugin action invoke delete-sandbox --plugin daytona.sandbox
herdr plugin action invoke connect-daytona --plugin daytona.sandbox
herdr plugin action invoke stop --plugin daytona.sandbox
herdr plugin action invoke info --plugin daytona.sandbox
herdr plugin action invoke replace-sandbox --plugin daytona.sandbox
herdr plugin action invoke forget-mapping --plugin daytona.sandbox
```

- **Start** captures the invoking Git worktree, including eligible uncommitted
  and untracked files. A new pane shows every eligible path, size, mode and hash,
  the destination and the manifest digest. Type `UPLOAD <full-digest>` there to
  approve those exact staged bytes before any provider connection or allocation.
  Other input cancels. Files changed locally during review do not replace the
  staged snapshot. Each independent start gets a separate sandbox.
- **Reconnect** uses the associated pane, or asks you to select a retained
  association for the current worktree. It never reuploads. A live PTY is
  reattached without launching another agent. After stop/archive recovery, a new
  agent process uses the same retained files.
- **Apply changes** exports files, compares them to the uploaded baseline or
  last applied checkpoint in an isolated local Git repository, and saves a
  binary-capable patch. The popup pages through the destination, changed paths,
  digest, and full patch before asking you to type `APPLY`. Terminal controls and
  invalid text bytes are displayed as visible escapes; the saved patch stays
  byte-exact. Cancellation changes
  neither local files nor checkpoint. The exact reviewed bytes must pass
  `git apply --check` again at application. Conflicts abort; nothing is staged,
  committed, reset, or merged automatically. Agent-created Git commits cannot
  hide edits. Repeating apply without new edits is a no-op.
- **Status** reports saved association, sandbox, agent version, paths, phase,
  last pane, and provider state. It never starts a stopped sandbox. A last pane
  ID is historical and may refer to a disconnected or closed pane. **Info** is
  an equivalent action and includes custom profile capability/auth metadata.
- **Connect Daytona account** verifies existing authentication without saving
  environment keys, or prompts for a key and saves it only after verification.
- **Stop** stops compute and retains files, baselines and recovery metadata.
  Reconnect restarts a prepared agent. Stopping an interrupted setup preserves
  its failure state; it does not make an incomplete workspace ready.
- **Replace sandbox** requires the exact named deletion confirmation, validates
  the local worktree and new configuration, then deletes the old sandbox and
  opens a fresh start with the current configuration and a new upload review.
- **Delete and forget mapping** uses the same named deletion confirmation and
  removes the association and its saved review/recovery artifacts only after
  provider-confirmed deletion. Local worktree files remain unchanged.
- **Delete** names the sandbox and requires `DELETE <sandbox-id>`. The local
  recovery record remains until Daytona confirms absence/destruction; a deletion
  tombstone remains afterward. Closing a pane or removing a worktree retains the
  sandbox. Optional removal cleanup still requires this confirmation and fails
  closed when the popup is unavailable/busy.

Popup entrypoints receive an explicit association because Herdr popups have no
pane ID. An occupied UI cannot approve a patch or deletion.

[Back to the README](../README.md)
