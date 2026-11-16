# Verification record

Date: 2026-11-16. This records observed local checks separately from provider
acceptance. Real Linux provider checks now pass as described below. Authenticated
agent work and the remaining agent/platform matrix are **open**; the plugin is
not yet verified as working end to end.

## Environment and versions

| Component            | Observed version / source                                                           |
| -------------------- | ----------------------------------------------------------------------------------- |
| Host                 | Linux x86_64, kernel 7.0.0-38-generic                                               |
| Node / npm           | 22.22.1 / 9.2.0                                                                     |
| Herdr minimum        | 0.8.0, official Linux x86_64 release binary                                         |
| Herdr current tested | 0.9.5, installed local binary                                                       |
| Daytona SDK          | `@daytona/sdk@0.231.1`, npm lockfile                                                |
| SDK source inspected | `daytona/clients` tag `v0.231.1`, commit `779af21af54cf31ba7b0baaaa006fac463e04ad9` |
| Image booted         | `node:22.22.0-bookworm`; Linux, remote Node 22.22.0 / npm 10.9.4                    |
| Live provider        | API configuration reports v0.232.1; sandbox daemon 0.232.2                          |
| Agent pins           | Codex 0.169.0; Claude Code 2.1.325; OpenCode 1.19.5; Pi 0.73.1                      |

Agent package pins were checked against the public npm registry. Codex installed
as `codex-cli 0.169.0` and reached its interactive login screen in Daytona. The
other three agents have not been installed or started in a real sandbox.

## Automated local checks

- `npm ci` followed by `npm run check`: pass on Linux with 35 tests, Prettier,
  ESLint and manifest verification. GitHub Actions runs the same check with
  Node 22 on Linux and macOS; see the [implementation PR checks](https://github.com/allagentsdev/herdr-daytona-sandbox/pull/2/checks)
  for current automation results. Interactive macOS acceptance remains open.
- Dependency installation from the public npm registry succeeded with zero npm
  audit findings. The host's unrelated configured npm registry was unreachable.
- Node tests cover config/auth opt-in, context selection, state concurrency and
  session isolation, filtered dirty linked-worktree capture, snapshot races,
  provider create/reconciliation and deletion failure handling, PTY byte/resize
  forwarding and cleanup, single launch on reconnect, and patch return.
- Patch tests run real Git in disposable repositories. They cover committed
  agent edits, dirty local baselines, additions/deletions/binary data/executable
  modes, cancellation, conflicts, repeat/incremental apply, artifact tampering,
  symlink/destination replacement, and interrupted checkpoint persistence.
- The actual remote export script runs locally against a repository with hostile
  Git configuration/hooks. It exports binary bytes without consulting that Git
  metadata, and a bounded streaming-download test rejects an oversized stream.
- SDK-shaped local transport tests exercise the full successful preparation path
  for all four adapters: binary upload, executable modes, Git initialization,
  installed-version recording, and an empty invoking subdirectory. Agent package
  installation and remote Linux platform identity are stubbed; these are not
  real agent startup checks.
- Separate Node processes verify mutual exclusion and atomic state updates after
  a dead lock owner. Regressions cover replacement lock owners, non-overlapping
  local edits, interruption before/after patch writes, complete exclusion
  inventories, initial PTY handshake recovery, and failed/unknown PTY exits.
- The real pinned SDK constructor is exercised from a hostile repository cwd.
  It runs in the plugin-owned SDK directory with the explicit expected endpoint
  and region. This test makes no provider request.
- Manifest verification checks the five actions, four pane entrypoints, retention
  event, production install hook, platform/minimum-version declarations, and SDK
  pin. ESLint and Prettier are part of `npm run check`.

These checks establish local behavior and SDK call shapes, not cloud transport,
authentication, provider persistence, or Herdr screen detection.

## Real Herdr checks on Linux

Both Herdr 0.8.0 and 0.9.5 were run with separate temporary XDG configuration,
data, state and runtime directories. Named headless sessions `dv080` and `dv095`
were created solely for these checks and stopped afterward. The existing user
session was not changed.

| Check                                                                         | 0.8.0   | 0.9.5              |
| ----------------------------------------------------------------------------- | ------- | ------------------ |
| `plugin link` with dependencies already installed                             | Pass    | Pass               |
| `plugin list` recognizes `daytona.sandbox`                                    | Pass    | Pass               |
| `plugin config-dir daytona.sandbox`                                           | Pass    | Pass               |
| Live server lists exactly five plugin actions                                 | Pass    | Pass               |
| Start action emits redacted versioned `missing_auth` result before allocation | Pass    | Pass               |
| GitHub review-branch install runs the production dependency hook              | Pass    | Pass               |
| Actual provider/agent pane attachment                                         | Not run | Codex login screen |

The first isolated test path exceeded Unix socket path length limits. Shorter
temporary paths resolved it; this did not require a plugin change.

Fresh `npm ci --omit=dev` succeeded in a disposable plugin directory containing
spaces (169 dependencies; npm audit: zero findings). Both Herdr versions linked
that path, and its runtime dispatcher emitted `missing_auth` from an unrelated
cwd with production dependencies only.

GitHub installation passed on both versions with
`plugin install allagentsdev/herdr-daytona-sandbox --ref feat/daytona-sandbox --yes`,
using fresh isolated configuration directories. Both installed implementation
commit `6331133c1f6dea2cdc393b2f8aa90f0600dfdf40` and registered five actions,
four pane entrypoints and the retention event. Default-branch install
cannot be verified until this implementation is merged.

## Real Daytona checks on Linux

After the user supplied management credentials, a fresh isolated Herdr 0.9.5
session created one EU sandbox through the plugin using SDK 0.231.1. This session
had its own XDG configuration, state and runtime directories. The existing user
session was not changed. Agent environment injection remained an empty allowlist;
no host agent authentication directory was copied.

- Real creation, preparation and Codex startup reached the remote login screen.
  The provider reported 1 vCPU, 1 GiB RAM, 3 GiB disk, `autoStopInterval: 15`,
  `autoDeleteInterval: -1`, and no destruction deadline. Creating and running the
  sandbox succeeded without adding funds. The API key could not read the wallet
  balance: the billing service returned HTTP 401, so no balance is asserted.
- The initial live attempt exposed a pane launch defect: passing the local
  worktree as the pane cwd made Node resolve `src/start-pane.mjs` there. Start
  and reconnect now use Herdr's plugin-root default; captured worktree context
  remains in the association. A real entrypoint subprocess regression failed
  before the repair and passed afterward. Actual Herdr start and reconnect then
  passed, as did all 35 tests and Linux/macOS CI.
- A dirty linked worktree uploaded two files, including binary data, with exact
  SHA-256 matches to the retained local baseline. A tracked `.env` was excluded.
  Checks found no Daytona management key or copied Codex authentication file in
  the sandbox.
- Closing a plugin pane and selecting the retained association from an
  unassociated pane reattached the saved live Codex PTY. Keyboard navigation
  reached the Codex login UI through the bridge, and Herdr identified it as
  Codex. A separate real SDK PTY check passed Unicode output, resize from
  100x30 to 123x37, raw Ctrl-C, disconnect without killing, and reattachment.
- Provider stop/start and archive/resume both preserved the checked workspace
  file hashes. Each plugin reconnect used the same sandbox and created exactly
  one fresh active agent PTY after the previous process ended. The real status
  popup reported the stopped sandbox without starting it. Archive completion
  was observed before reconnecting.
- Remote fixture edits were made and committed through SDK commands while the
  Codex pane was at login; these were **not model-generated edits**. The actual
  review popup showed the destination, exact digest, changed paths, text,
  Unicode, binary patch and executable mode. Cancelling preserved local bytes;
  typing `APPLY` applied the reviewed result with the local index unchanged.
- Subsequent live exports through the patch module were no-ops after apply.
  Another remote commit changed text and deleted an executable. Its saved review
  artifact rejected conflicting local edits without writes, then applied the
  exact reviewed bytes after resolving the conflict. Another export was a no-op.
- Cancelling the named deletion popup retained the sandbox. Removing the actual
  Herdr-managed test worktree retained the running sandbox and marked its
  association orphaned. Typing the exact `DELETE <sandbox-id>` confirmation then
  deleted that test sandbox; a fresh provider lookup confirmed its absence and
  the association was marked deleted. The isolated Herdr server, TUI client and
  automation daemon were stopped afterward.

The Daytona key authenticates sandbox management, not the selected coding agent's
model service. Codex remained at login; no authenticated model task ran. The
15-minute configured value was checked at the provider, but a timed inactivity
experiment and its interaction with terminal traffic were not performed.

## Live acceptance matrix — still required

Initial local checks ran without Daytona credentials. The subsequent authorized
live checks above used an API key and one sandbox. No model API key or remote
agent login was supplied for an authenticated task. A macOS host was unavailable.

- [ ] Real interactive startup and authentication for all four pinned agents,
      with exact installed versions and image/snapshot identity recorded.
- [ ] Complete bridge checks for all four agents. Codex login navigation,
      detach/reconnect and detection passed; separate SDK PTY byte/resize/Ctrl-C
      checks passed, but authenticated agent interaction remains open.
- [ ] Provider stop/start retains byte-identical workspace files and restarts one
      agent. Stop/start and archive recovery passed for Codex at login; check how
      terminal traffic affects the 15-minute provider inactivity interval.
- [ ] From a dirty linked worktree, verify actual upload exclusions and byte
      identity, then return agent-committed and binary changes through the real
      popup. Cancel once, approve once, exercise conflict and repeat/incremental
      apply without disturbing the local index. Real committed fixture edits
      passed these flows; repeat with authenticated model-generated changes.
- [x] Confirm named deletion against the real provider and retained worktree
      removal. Cancellation and confirmed deletion passed live; uncertain
      deletion recovery has automated local fault coverage only.
- [ ] Repeat install/check and relevant interactive flows on macOS with Node 22
      and both supported Herdr versions. CI alone is not interactive evidence.
- [ ] After merge, verify the documented default-branch GitHub installation.

Keep these criteria open when credentials, provider access or a host are
unavailable. Do not infer completion from the local fakes or a passing CI run.
