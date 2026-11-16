# Verification record

Date: 2026-11-16. This records observed local checks separately from provider
acceptance. The cloud lifecycle matrix is **open**; the plugin is not yet verified
as working end to end.

## Environment and versions

| Component            | Observed version / source                                                           |
| -------------------- | ----------------------------------------------------------------------------------- |
| Host                 | Linux x86_64, kernel 7.0.0-38-generic                                               |
| Node / npm           | 22.22.1 / 9.2.0                                                                     |
| Herdr minimum        | 0.8.0, official Linux x86_64 release binary                                         |
| Herdr current tested | 0.9.5, installed local binary                                                       |
| Daytona SDK          | `@daytona/sdk@0.231.1`, npm lockfile                                                |
| SDK source inspected | `daytona/clients` tag `v0.231.1`, commit `779af21af54cf31ba7b0baaaa006fac463e04ad9` |
| Image configured     | `node:22.22.0-bookworm`; no live image boot verified                                |
| Agent pins           | Codex 0.169.0; Claude Code 2.1.325; OpenCode 1.19.5; Pi 0.73.1                      |

Agent package pins were checked against the public npm registry. They were not
installed into a Daytona sandbox and are not evidence of interactive support.

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

| Check                                                                         | 0.8.0   | 0.9.5   |
| ----------------------------------------------------------------------------- | ------- | ------- |
| `plugin link` with dependencies already installed                             | Pass    | Pass    |
| `plugin list` recognizes `daytona.sandbox`                                    | Pass    | Pass    |
| `plugin config-dir daytona.sandbox`                                           | Pass    | Pass    |
| Live server lists exactly five plugin actions                                 | Pass    | Pass    |
| Start action emits redacted versioned `missing_auth` result before allocation | Pass    | Pass    |
| GitHub review-branch install runs the production dependency hook              | Pass    | Pass    |
| Actual provider/agent pane attachment                                         | Not run | Not run |

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
cannot be verified until this implementation is merged; no merge is authorized
by this work.

## Live acceptance matrix — still required

No Daytona API key, SDK JWT/organization pair, OpenAI API key, or Anthropic API key
was present in the implementing process. No undocumented credential stores were
read and no sandbox was created for these checks. A macOS host was unavailable.

- [ ] Real interactive startup and authentication for all four pinned agents,
      with exact installed versions and image/snapshot identity recorded.
- [ ] Raw input, Unicode, resize, Ctrl-C, abrupt detach and reattach reach the same
      live PTY without a second agent or sandbox. Confirm Herdr detection kinds.
- [ ] Provider stop/start retains byte-identical workspace files and restarts one
      agent. Test archive recovery when available; check how terminal traffic
      affects the 15-minute provider inactivity interval.
- [ ] From a dirty linked worktree, verify actual upload exclusions and byte
      identity, then return agent-committed and binary changes through the real
      popup. Cancel once, approve once, exercise conflict and repeat/incremental
      apply without disturbing the local index.
- [ ] Confirm named deletion against the real provider, including uncertain
      deletion recovery; verify worktree removal retains the sandbox by default.
- [ ] Repeat install/check and relevant interactive flows on macOS with Node 22
      and both supported Herdr versions. CI alone is not interactive evidence.
- [ ] After merge, verify the documented default-branch GitHub installation.

Keep these criteria open when credentials, provider access or a host are
unavailable. Do not infer completion from the local fakes or a passing CI run.
