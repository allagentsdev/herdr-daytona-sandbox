# Vercel workflow comparison

This compares the Daytona implementation with Herdr's Vercel plugin at
[`be8393a`](https://github.com/vercel-labs/herdr-vercel-sandbox-plugin/blob/be8393aac17eae4b67ca58fdcc5ad8233f91b6c5/README.md).
The reference informed behavior; its code was not reused. Provider-specific
authentication and lifecycle settings differ. Live evidence and any remaining
verification gaps are recorded in [verification](verification.md).

| Vercel capability                              | Daytona equivalent                                                                                           |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Connect account                                | `connect-daytona`: read-only verification and masked local API-key setup                                     |
| Link Vercel team/project                       | Daytona API keys select their owning organization; Vercel project linking does not apply                     |
| Start configured agent                         | `start-agent`: one sandbox per independent start, filtered dirty/untracked worktree snapshot                 |
| Review upload manifest before creation         | Complete immutable manifest plus typed `UPLOAD <digest>` in the progress pane                                |
| Reconnect agent                                | `reconnect`: retained selection, live PTY reattachment, stopped/archived storage resume                      |
| Apply changes                                  | `apply-changes`: exact patch review, binary/mode changes, checked conflict handling, incremental checkpoints |
| Stop sandbox                                   | `stop`: confirmed stopped compute, retained files and recovery metadata                                      |
| Show mapping                                   | `info` or `status`, including installed version, provider state and custom capability declarations           |
| Replace sandbox                                | `replace-sandbox`: named deletion confirmation, then a fresh reviewed start                                  |
| Delete and forget mapping                      | `forget-mapping`: named deletion, then removal of saved mapping and artifacts                                |
| Declarative custom agent profiles              | Nine-field `customAgents` profiles, explicit `allowCandidateAgents`, unverified label                        |
| Additional path/directory/extension exclusions | `excludedPaths`: exact paths, `dir/`, `dir/**`, and `*.ext`                                                  |
| Machine-readable action results                | Versioned `DAYTONA_RESULT` envelopes; the Vercel-specific envelope is not an API compatibility promise       |

The four builtin choices are Claude Code, Codex, OpenCode and Pi. Custom profiles
must describe an interactive terminal agent with resume support. Profile commands
run remotely; host-side JavaScript adapters are not imported from configuration.

Some differences are deliberate:

- Mandatory credential, Git metadata, environment-file and private-key exclusions
  cannot be overridden. The Vercel reference's sensitive-file override is not
  provided. Additional excludes only remove more files. Extension suffixes are literal;
  brace expansion and general glob expressions are unsupported.
- Provider keys require an explicit environment allowlist. Host authentication
  directories are not copied. Saved Daytona management keys remain local.
- Daytona uses native 15-minute provider-detected inactivity stop by default,
  with auto-delete and destructive wall-clock TTL disabled. Stopping ends agent
  processes while retaining files. This differs from Vercel runtime timeouts.
- Daytona uses the pinned SDK rather than a local provider CLI. A Daytona CLI
  login does not automatically authenticate SDK calls. Images/snapshots and
  organization-scoped credentials replace Vercel's image/runtime and project
  settings.
- Linux/macOS with Node 22 and Herdr 0.8.0+ remain the supported host contract;
  this does not claim Vercel's older minimum host versions.

The comparison covers the user workflows above. It does not claim identical
configuration field names, provider APIs, model behavior, or verification tooling.
