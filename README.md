# Daytona Sandbox for Herdr

[![CI](https://github.com/allagentsdev/herdr-daytona-sandbox-plugin/actions/workflows/ci.yml/badge.svg)](https://github.com/allagentsdev/herdr-daytona-sandbox-plugin/actions/workflows/ci.yml)
[![License](https://img.shields.io/github/license/allagentsdev/herdr-daytona-sandbox-plugin)](LICENSE)

Run Claude Code, Codex, OpenCode or Pi in a persistent Daytona Linux sandbox
without leaving Herdr.

Your Git worktree stays local. The plugin uploads a filtered snapshot, opens the
remote agent in a Herdr pane, and returns its changes as a patch you review and
approve before it changes local files.

## Quick start

You need Linux or macOS, [Herdr 0.8.0+](https://herdr.dev/docs/), Node.js 22+,
npm, Git and a Daytona account. The plugin uses the Daytona SDK; local agent
binaries and the Daytona CLI are unnecessary.

Install the plugin:

```sh
herdr plugin install allagentsdev/herdr-daytona-sandbox-plugin
```

Then:

1. Open a local shell pane inside a Git worktree in Herdr.
2. Start the default agent, Codex:

   ```sh
   herdr plugin action invoke start-agent --plugin daytona.sandbox
   ```

3. If Daytona credentials are missing, Start opens **Connect Daytona account**.
   Enter your [API key](https://app.daytona.io/dashboard/keys) in the masked popup, then invoke Start again. You can also
   supply `DAYTONA_API_KEY` in the Herdr server's environment.
4. Review the upload manifest and destination in the new pane. Type
   `UPLOAD <full-digest>` using the displayed digest to approve those exact bytes.
5. Sign in to the coding agent inside the sandbox, then give it a task.
   Daytona authentication and the agent's model authentication are separate.
6. Return to a local shell pane in the same Herdr workspace and review the result:

   ```sh
   herdr plugin action invoke apply-changes --plugin daytona.sandbox
   ```

   Read the destination, changed paths and full patch, then type `APPLY` to
   approve it. Cancellation leaves local files unchanged. Conflicts abort
   without staging, committing, resetting or automatically merging anything.

Each Start creates an independent sandbox. Reconnect reuses an existing one.
By default, Daytona stops compute after **15 minutes of provider-detected
inactivity**, retaining files and ending running processes. Delete a sandbox
explicitly when finished; storage charges may continue after stop.

## Choose an agent

Find the managed configuration directory:

```sh
herdr plugin config-dir daytona.sandbox
```

Create `config.json` there, for example:

```json
{ "agent": "claude-code", "agentArgs": [] }
```

Use `codex`, `claude-code`, `opencode` or `pi`. Settings affect new sandboxes;
existing associations retain the configuration used to create them. Host agent
sessions and keys are not copied by default. Use the agent's own login or an
[explicit provider-key allowlist](docs/configuration.md#authentication-and-agent-selection).
Never put secret values in configuration or agent arguments.

| Agent       | Pinned package                         | Herdr detection kind |
| ----------- | -------------------------------------- | -------------------- |
| Codex       | `@openai/codex@0.169.0`                | `codex`              |
| Claude Code | `@anthropic-ai/claude-code@2.1.325`    | `claude`             |
| OpenCode    | `opencode-ai@1.19.5`                   | `opencode`           |
| Pi          | `@mariozechner/pi-coding-agent@0.73.1` | `pi`                 |

All four pins completed authenticated Linux coding tasks and reviewed patch
return with Herdr 0.9.5 and Daytona SDK 0.231.1. Local checks and Linux/macOS CI
pass. Interactive macOS, Herdr 0.8.0 cloud attachment and timed inactivity behavior
remain unverified; see the [verification record](docs/verification.md).

## Actions

Run actions from a local shell in the relevant Herdr workspace or use Herdr's
workspace/pane action picker. The remote agent pane does not have your local
Herdr CLI or shell functions.

| Action ID         | What it does                                                             |
| ----------------- | ------------------------------------------------------------------------ |
| `start-agent`     | Creates a sandbox after upload approval and opens the configured agent.  |
| `connect-daytona` | Verifies credentials or prompts for a management API key locally.        |
| `reconnect`       | Selects a retained association and reconnects without reuploading.       |
| `apply-changes`   | Shows and applies the exact reviewed patch after approval.               |
| `status` / `info` | Shows the mapping, installed agent version and provider state.           |
| `stop`            | Stops compute while retaining files and recovery metadata.               |
| `replace-sandbox` | Confirms deletion, then starts a replacement with a fresh upload review. |
| `delete-sandbox`  | Confirms deletion while retaining a local deletion record.               |
| `forget-mapping`  | Confirms deletion, then removes the mapping and saved artifacts.         |

For example, reconnect to a retained sandbox:

```sh
herdr plugin action invoke reconnect --plugin daytona.sandbox
```

See the [action reference](docs/actions.md) for selection, confirmation and
failure behavior.

## Persistence and costs

Sandboxes use `autoDeleteInterval: -1` and `ttlMinutes: 0`: there is no automatic
deletion or destructive wall-clock deadline. The configurable 15-minute inactivity
auto-stop retains files, not running processes or agent memory. Reconnect resumes
the same storage and starts a new agent process when needed. Archive recovery
also passed the Linux live check.

The effect of terminal traffic on Daytona's inactivity accounting is unverified.
Increase `autoStopInterval`, or set it to `0`, for longer unattended work,
accounting for ongoing compute charges. Storage and other provider charges may
continue after stop.

Deletion requires `DELETE <sandbox-id>`. Closing a pane or removing a worktree
retains the sandbox by default. Optional cleanup on worktree removal still asks
for named deletion confirmation. Replacement also permanently deletes remote files.

## Upload and patch safety

The snapshot includes eligible dirty and untracked files. Mandatory exclusions
remove Git metadata, ignored paths, dependencies, environment files and known
credentials. Symlinks are skipped. These filters cannot be disabled, and they
are not a general secret scanner: inspect the manifest and add exclusions for
private source or unrecognized secrets.

Remote edits stay remote until you approve a patch. Binary bytes, executable
modes and agent-committed changes are included. Application checks conflicts and
preserves the local index; repeating apply without new edits is a no-op.
An approved patch advances a checkpoint for the next return.

See [file boundaries](docs/configuration.md#file-boundaries) for limits and
[recovery](docs/recovery.md) for retained baselines, interrupted operations and
review artifacts. Keep recovery files until remote cleanup is complete.

## Documentation

- [Configuration and authentication](docs/configuration.md)
- [Custom terminal agents](docs/configuration.md#custom-terminal-agents)
- [Action reference](docs/actions.md)
- [Recovery and automation](docs/recovery.md)
- [Verification and remaining coverage](docs/verification.md)
- [Vercel workflow comparison](docs/vercel-parity.md)
- [Third-party notices](THIRD_PARTY_NOTICES.md) and [MIT license](LICENSE)

## Development

Install dependencies **before linking** a local checkout; Herdr does not run
build hooks on link:

```sh
npm ci
npm run check
herdr plugin link "$PWD"
herdr plugin action list --plugin daytona.sandbox
```

GitHub installation runs `npm ci --omit=dev` automatically. Installed/linked
plugins are global to your Herdr configuration. Use temporary XDG directories
and a named Herdr session for integration tests to protect existing panes.

Checks run Prettier, ESLint, manifest verification and Node tests. CI uses Node 22
on Linux/macOS and never uses cloud credentials. The
[implementation plan](docs/plans/2026-11-16-1306-feat-daytona-sandbox-plugin-plan.md)
records the original requirements; the verification record tracks observed results
and remaining acceptance coverage.
