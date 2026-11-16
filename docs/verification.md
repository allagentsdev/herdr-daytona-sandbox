# Verification record

Date: 2026-11-16. The plugin completed authenticated Linux tasks and reviewed
patch return for all four pinned agents. Automated checks, real provider checks,
and remaining host coverage are recorded separately. These observations apply to
the configurations below; they do not establish every possible model or image.

## Environment

| Component            | Observed version                                                                    |
| -------------------- | ----------------------------------------------------------------------------------- |
| Host                 | Linux x86_64, kernel 7.0.0-38-generic                                               |
| Host Node / npm      | 22.22.1 / 9.2.0                                                                     |
| Herdr                | 0.8.0 install/link checks; 0.9.5 authenticated interactive checks                   |
| Daytona SDK          | `@daytona/sdk@0.231.1`, locked exact version                                        |
| SDK source inspected | `daytona/clients` tag `v0.231.1`, commit `779af21af54cf31ba7b0baaaa006fac463e04ad9` |
| Sandbox image        | `node:22.22.0-bookworm`, remote Node 22.22.0 / npm 10.9.4                           |
| Provider observed    | API configuration v0.232.1; sandbox daemon 0.232.2                                  |

## Automated checks

`npm ci` and `npm run check` pass locally. The current suite has **65 tests**,
plus Prettier, ESLint and manifest checks. GitHub Actions runs clean installation
and the same check with Node 22 on Linux and macOS; consult the
[PR checks](https://github.com/allagentsdev/herdr-daytona-sandbox/pull/2/checks)
for the result at the published commit. CI is not interactive macOS evidence.

Tests use real disposable Git repositories for dirty linked-worktree capture,
mandatory exclusions, committed changes, binary bytes, executable modes,
cancellation, conflicts, incremental application and checkpoint interruption.
Separate-process locking tests cover state isolation and stale owners. Fault
coverage includes uncertain creation/deletion/stop, failed setup, exact approval
binding after reconciliation, competing upload reviews, forgotten associations,
and superseded terminal cleanup. A regression holds a state writer while forget
waits, proving it cannot recreate the removed mapping.

Transport fakes exercise successful preparation for all adapters and PTY
byte/resize forwarding, single launch, handshake recovery and cleanup. The real
pinned SDK constructor runs from a trusted plugin-owned directory despite a
hostile repository cwd. Those tests make no provider request. The actual remote
export helper runs locally against hostile Git metadata without executing its
hooks or trusting its configuration.

Full code review and simplification passes completed. Validated findings were
fixed with regression coverage. The attempted external Claude review failed at
transport before prompt egress; it is not counted as cross-model evidence.

## Herdr installation

Isolated Linux sessions using Herdr **0.8.0** and **0.9.5** passed plugin linking,
action listing, config-directory lookup, missing-auth execution, and GitHub/ref
installation. These initial checks used implementation commit
`6331133c1f6dea2cdc393b2f8aa90f0600dfdf40` with the original five actions and four
entrypoints. Herdr 0.9.5 subsequently registered and exercised the expanded ten
actions and five entrypoints. A fresh isolated 0.8.0 link and live server action
listing also passed for the expanded ten-action/five-entrypoint manifest at
`2f5fe9e`. Its server was stopped afterward.

Fresh `npm ci --omit=dev` passed in a disposable path containing spaces, with
169 production dependencies and no npm audit findings. Both Herdr versions linked
that path and invoked its dispatcher from an unrelated cwd. GitHub installation
used `plugin install allagentsdev/herdr-daytona-sandbox --ref feat/daytona-sandbox --yes`.
Default-branch GitHub installation subsequently passed on both Herdr 0.8.0 and
0.9.5 at merged commit `e4eac07874168c239ab36d5b93f1225a4b3c2e6f`.

## Authenticated agent tasks

A private, isolated Herdr **0.9.5** session used user-authorized Daytona and
OpenRouter credentials. Keys were retrieved directly into child-process
environments. Agent keys required an explicit allowlist; no host authentication
directory or Daytona management key was copied into a sandbox.

| Agent                | Installed version   | Model route                              | Committed task result                                                                                              |
| -------------------- | ------------------- | ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Codex                | `codex-cli 0.169.0` | OpenRouter `openai/gpt-5.6-sol`, low     | Fixed arithmetic, ran tests, wrote a unique Unicode proof and committed `323e47c77b52d25605b1202bc7651da3b2324852` |
| OpenCode             | `1.19.5`            | OpenRouter `openai/gpt-5.6-sol`          | Added arithmetic assertions, ran tests and committed `45099aee8534b6da56a0869fae9a209847d3fe8a`                    |
| Pi                   | `0.73.1`            | OpenRouter `openai/gpt-5.6-sol`          | Added assertions, ran tests and committed `944aa180ed2f88c56e15d7f2de12e59721787317`                               |
| Claude Code          | `2.1.325`           | OpenRouter `anthropic/claude-sonnet-4.6` | Added assertions, ran tests and committed `ffa4467317a27f6f2f13eea0ef1ce7b01d608349`                               |
| Custom Codex profile | `codex-cli 0.169.0` | OpenRouter `openai/gpt-5.6-sol`, low     | Committed text, four binary bytes and an executable script in `dfa13b9fccb2da7dc1c48d2926d3f272e0becd61`           |

The redacted [task receipts](evidence/2026-11-16-agent-tasks.json) retain exact
versions, challenge tokens, remote commits and verification times.

Each task ran through its interactive Herdr pane. Independent SDK downloads
verified unique Unicode challenge bytes and remote test success. The three
additional builtin patches were exported through the real dispatcher, inspected,
and applied by exact artifact ID and digest in separate approval invocations.
Local tests passed with the index unchanged. Codex and custom Codex used the
actual review popup and typed `APPLY`; the latter returned binary bytes
`00 ff 2a 80` and mode `100755`. The original dirty local comment survived.
Pi warned that the model was absent from its local catalog, then successfully
used the explicitly supplied model ID.

Closing and reopening OpenCode, Pi and Claude Code panes reattached each saved
live PTY; Herdr recognized the respective agent and reported it idle. Codex also
passed live detach/reconnect. A custom profile remains labelled
`user-provided-unverified`: one successful profile does not verify arbitrary
user commands or claimed capabilities.

## Provider and lifecycle checks

- Creation succeeded without an additional deposit. Wallet reads returned HTTP
  401, so no Daytona balance is asserted. Five sandboxes were created in the
  authenticated session: four builtin starts and one replacement/custom start.
- The provider reported `autoStopInterval: 15`, `autoDeleteInterval: -1` and no
  destruction deadline. Complete manifests were displayed and their exact
  `UPLOAD <digest>` confirmations entered before allocation.
- Dirty linked-worktree bytes matched retained baseline hashes. A tracked `.env`
  was excluded. Checks found no management key or copied Codex auth file remotely.
- Manual stop ended compute while retaining files. Reconnect resumed the same
  sandbox and launched one fresh agent PTY. Earlier stop/start and archive/resume
  checks also preserved file hashes. A status popup did not start stopped compute.
- Replacement required the exact old sandbox ID, confirmed deletion, then opened
  a new upload review. The resulting custom Codex profile completed its task.
- Read-only account connect verified the supplied key without allocating compute.
  Masked key entry and owner-only atomic credential persistence have local tests;
  live saved-key entry was not needed because environment credentials worked.
- Forget mapping required named deletion, then removed the mapping and saved
  artifacts while the custom Codex pane was attached. The bridge exited cleanly.
- Actual Herdr worktree removal retained the three remaining builtin sandboxes
  and marked their mappings orphaned. Explicit named deletion then removed them.
  Fresh provider lookups confirmed all five session sandboxes absent. The named
  test server, TUI client and automation daemon were then stopped. The existing
  user session was untouched.
- Earlier fixture-only checks passed review cancellation, conflict rejection,
  incremental text/deletion return and repeat no-op exports. A separate real SDK
  PTY passed Unicode, resize 100x30 to 123x37, raw Ctrl-C, disconnect and reattach.
  The earlier sandbox was also explicitly deleted.

The first live start exposed an entrypoint cwd defect. The repaired panes resolve
scripts from the installed plugin root; a real entrypoint subprocess regression
failed before the fix and passed afterward. Later review caught upload approval
and cleanup races; targeted regressions failed before their fixes and pass now.

## Remaining acceptance coverage

- [x] Authenticated interactive startup and committed task for all four exact pins.
- [x] Dirty linked-worktree upload and reviewed model-generated patch return.
- [x] Detach/reconnect, retained stop/start, archive recovery and named deletion.
- [x] Custom profile, manual stop, replacement and attached forget workflows.
- [ ] Interactive macOS acceptance. No macOS host was available; CI does not close it.
- [ ] Timed 15-minute inactivity accounting with and without terminal traffic.
      The configured provider value is verified; SDK/terminal activity can update
      the provider's last-activity timestamp, so elapsed idle behavior is not claimed.
- [ ] Cloud pane attachment on Herdr 0.8.0. Expanded ten-action/five-entrypoint
      registration passed; cloud interaction used 0.9.5.
- [x] Default-branch GitHub installation after merge, on Herdr 0.8.0 and 0.9.5.

These gaps remain open. No complete cross-platform acceptance claim follows from
Linux dogfooding. See the [Vercel workflow comparison](vercel-parity.md) for the
supported parity surface and deliberate provider/security differences.
