# Herdr Daytona Sandbox

Run Claude Code, Codex, OpenCode, or Pi in a persistent Daytona Linux sandbox
from a Herdr pane. Upload a filtered snapshot of a Git worktree, reconnect to its
saved workspace, then review and explicitly approve remote changes locally.

**Implementation under verification.** Local checks and Linux Herdr linking are
recorded in [verification](docs/verification.md). Real Daytona and interactive
agent lifecycle checks remain open; this is not yet a verified cloud release.

## Install

Requires Linux or macOS, Herdr 0.8.0+, Node.js 22+, npm, and Git. Local agent
binaries and the Daytona CLI are unnecessary.

After this implementation reaches the default branch:

```sh
herdr plugin install allagentsdev/herdr-daytona-sandbox
```

Until then, install the review branch:

```sh
herdr plugin install allagentsdev/herdr-daytona-sandbox --ref feat/daytona-sandbox
```

The install hook runs `npm ci --omit=dev`. For a local checkout, install
dependencies **before linking**; Herdr does not run build hooks on link:

```sh
npm ci
herdr plugin link "$PWD"
herdr plugin action list --plugin daytona.sandbox
herdr plugin config-dir daytona.sandbox
```

Installed/linked plugins are global to your Herdr configuration. Development
checks should use temporary XDG directories and a named Herdr session to protect
your normal configuration and panes.

## Authentication and configuration

Provide `DAYTONA_API_KEY` in the environment of the Herdr server that launches
plugin actions. Alternatively provide both `DAYTONA_JWT_TOKEN` and
`DAYTONA_ORGANIZATION_ID`. Configuration can reference other host variable names;
it never contains their secret values. Restart only a session you own when
changing its inherited environment. A Daytona CLI login profile does not
automatically authenticate the SDK.

Put `config.json` in the directory printed by `herdr plugin config-dir
daytona.sandbox`. Start from [config.example.json](config.example.json), or a
minimal object:

```json
{ "agent": "codex", "agentArgs": [], "autoStopInterval": 15 }
```

No host agent auth directories or provider keys are copied by default. Use the
agent's own sign-in interface inside the sandbox, or explicitly allow named host
provider keys:

```json
{
  "agent": "claude-code",
  "agentEnvAllowlist": ["ANTHROPIC_API_KEY"]
}
```

Each allowlisted variable must be present when starting. Only uppercase provider
`*_API_KEY` / `*_TOKEN` names and AWS access-key variable names are accepted.
Daytona management variables, including configured aliases, are forbidden.
Keys go only to the selected remote PTY; they are absent from local association
records and upload files. Codex's explicit `OPENAI_API_KEY` injection also runs
its API-key login within that remote terminal. Never put secrets in `agentArgs`.

The SDK runs from a private plugin state directory with explicit credentials,
endpoint, and region, avoiding repository-controlled `.env` files.

| Field                  | Default                      | Meaning                                                                              |
| ---------------------- | ---------------------------- | ------------------------------------------------------------------------------------ |
| `agent`                | `codex`                      | `codex`, `claude-code`, `opencode`, or `pi`                                          |
| `agentArgs`            | `[]`                         | Literal argv array; values are shell quoted individually                             |
| `region`               | `eu`                         | Explicit Daytona target; no automatic region fallback                                |
| `image`                | `node:22.22.0-bookworm`      | Linux image with Bash, Git, Node 22+, npm, root installation access                  |
| `snapshot`             | `null`                       | Existing Daytona snapshot; when supplied without `image`, replaces the default image |
| `remoteRoot`           | `/workspace`                 | Normalized `/workspace` or a path beneath it                                         |
| `excludedPaths`        | `[]`                         | Additional literal repository-relative files/directories; no globs                   |
| `maxFiles`             | `10000`                      | Maximum included snapshot/export file count                                          |
| `maxFileBytes`         | `10485760`                   | Maximum individual file size (10 MiB)                                                |
| `maxUploadBytes`       | `104857600`                  | Maximum total snapshot/export bytes (100 MiB)                                        |
| `autoStopInterval`     | `15`                         | Provider-detected inactivity minutes; `0` disables automatic stop                    |
| `createTimeoutSeconds` | `300`                        | Sandbox create/start/delete operation timeout                                        |
| `execTimeoutSeconds`   | `300`                        | Setup commands and individual file transfers                                         |
| `requestTimeoutMs`     | `60000`                      | SDK HTTP request timeout; separate from operation deadlines                          |
| `agentEnvAllowlist`    | `[]`                         | Explicit named host provider keys to inject                                          |
| `onWorktreeRemoved`    | `retain`                     | `retain`, or `confirm-delete` to request a deletion dialog                           |
| `installDependencies`  | `false`                      | Opt in to running project `npm ci` remotely; package scripts execute project code    |
| `apiUrl`               | `https://app.daytona.io/api` | Explicit HTTPS management endpoint                                                   |
| `apiKeyEnv`            | `DAYTONA_API_KEY`            | Host API-key variable name, preferred over JWT                                       |
| `jwtTokenEnv`          | `DAYTONA_JWT_TOKEN`          | Host SDK JWT variable name                                                           |
| `organizationIdEnv`    | `DAYTONA_ORGANIZATION_ID`    | Host organization variable name for JWT auth                                         |

Choose one image or snapshot; explicitly setting both fails validation. Unknown
fields and invalid settings fail before compute allocation. Timeouts do not
prove a provider request was cancelled.

## Actions

Use Herdr's workspace/pane action picker, or:

```sh
herdr plugin action invoke start-agent --plugin daytona.sandbox
herdr plugin action invoke reconnect --plugin daytona.sandbox
herdr plugin action invoke apply-changes --plugin daytona.sandbox
herdr plugin action invoke status --plugin daytona.sandbox
herdr plugin action invoke delete-sandbox --plugin daytona.sandbox
```

- **Start** captures the invoking Git worktree, including eligible uncommitted
  and untracked files. A new pane shows the file manifest and provisioning
  progress while preserving focus. Each start gets a separate sandbox.
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
  ID is historical and may refer to a disconnected or closed pane.
- **Delete** names the sandbox and requires `DELETE <sandbox-id>`. The local
  recovery record remains until Daytona confirms absence/destruction; a deletion
  tombstone remains afterward. Closing a pane or removing a worktree retains the
  sandbox. Optional removal cleanup still requires this confirmation and fails
  closed when the popup is unavailable/busy.

Popup entrypoints receive an explicit association because Herdr popups have no
pane ID. An occupied UI cannot approve a patch or deletion.

## Persistence and costs

Sandboxes are non-ephemeral, with `autoDeleteInterval: -1` and `ttlMinutes: 0`.
The default **15-minute inactivity auto-stop retains files and ends running
processes**. This is not a promise that agent memory or an unattended run survives
a stop. Provider archival retains files; archive recovery remains a live test
gap. The effect of terminal traffic on provider inactivity accounting is also
unverified. Increase/disable auto-stop explicitly for longer unattended work,
accounting for ongoing compute charges. Storage and other provider charges may
continue after stop. Delete explicitly when finished.

Pinned agent installers:

| Agent       | Package                                | Herdr detection kind |
| ----------- | -------------------------------------- | -------------------- |
| Codex       | `@openai/codex@0.169.0`                | `codex`              |
| Claude Code | `@anthropic-ai/claude-code@2.1.325`    | `claude`             |
| OpenCode    | `opencode-ai@1.19.5`                   | `opencode`           |
| Pi          | `@mariozechner/pi-coding-agent@0.73.1` | `pi`                 |

These pins are available package versions, not interactive verification
receipts. Startup checks record the actual installed version. Custom images must
provide the required tools; failures retain the sandbox for inspection.

## File boundaries

Mandatory exclusions cannot be disabled: Git metadata, nested repositories and
submodules, dependency/build/cache directories, `.env` and all variants,
known credential files/directories, private-key extensions, and agent auth or
session archives. Symlinks are skipped without dereferencing. Executable modes,
empty files, UTF-8 names (including spaces/newlines), and binary data are
preserved. Git LFS pointers remain pointers; payloads are not fetched. Non-UTF-8
filenames are unsupported.

Tracked-but-ignored files are filtered too. High-confidence secret patterns add
another exclusion, but this is **not a general secret scanner**: unknown secrets
inside otherwise eligible source can still leave your machine. Inspect the
printed upload summary and use additional excludes as needed. Excluded content
can make a project incomplete. Downloads enforce path, file-count, and byte
limits before applying, and remote Git metadata/config/hooks never control the
returned diff. Export uses the configured path/secret policy rather than
agent-controlled ignore rules.

## Review artifacts and recovery

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

## Development

```sh
npm ci
npm run check
```

Checks run Prettier, ESLint, manifest verification, and Node tests. CI runs on
Linux/macOS with Node 22 and never uses cloud credentials. The
[reviewed implementation plan](docs/plans/2026-11-16-1306-feat-daytona-sandbox-plugin-plan.md)
defines the open live acceptance matrix. See [third party notices](THIRD_PARTY_NOTICES.md)
for the MIT Blaxel adaptations; Vercel was a behavior reference only.
