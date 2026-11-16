# Configuration

[Back to the README](../README.md)

Every setting is optional. The default starts Codex in an EU sandbox with a
15-minute inactivity auto-stop. See [config.example.json](../config.example.json)
for a complete example.

## Authentication and agent selection

Provide `DAYTONA_API_KEY` in the environment of the Herdr server that launches
plugin actions. Alternatively provide both `DAYTONA_JWT_TOKEN` and
`DAYTONA_ORGANIZATION_ID`, or invoke **Connect Daytona account** to enter a key in
a masked local popup. The connection action checks the key with a read-only
request before saving it in the private plugin configuration directory, bound
to the configured API endpoint. It never creates a sandbox. Start opens this
setup popup when credentials are missing; finish setup and invoke Start again.
Explicit API-key environment authentication takes precedence, then complete JWT
authentication, then the saved key. Configuration can reference other host variable names;
it never contains their secret values. Restart only a session you own when
changing its inherited environment. A Daytona CLI login profile does not
automatically authenticate the SDK.

Put `config.json` in the directory printed by `herdr plugin config-dir
daytona.sandbox`. Start from [config.example.json](../config.example.json), or a
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

| Field                  | Default                      | Meaning                                                                                |
| ---------------------- | ---------------------------- | -------------------------------------------------------------------------------------- |
| `agent`                | `codex`                      | `codex`, `claude-code`, `opencode`, or `pi`                                            |
| `agentArgs`            | `[]`                         | Literal argv array; values are shell quoted individually                               |
| `region`               | `eu`                         | Explicit Daytona target; no automatic region fallback                                  |
| `image`                | `node:22.22.0-bookworm`      | Linux image with Bash, Git, Node 22+, npm, root installation access                    |
| `snapshot`             | `null`                       | Existing Daytona snapshot; when supplied without `image`, replaces the default image   |
| `remoteRoot`           | `/workspace`                 | Normalized `/workspace` or a path beneath it                                           |
| `excludedPaths`        | `[]`                         | Additional exact paths, directory prefixes (`dir/`, `dir/**`), or extensions (`*.ext`) |
| `maxFiles`             | `10000`                      | Maximum included snapshot/export file count                                            |
| `maxFileBytes`         | `10485760`                   | Maximum individual file size (10 MiB)                                                  |
| `maxUploadBytes`       | `104857600`                  | Maximum total snapshot/export bytes (100 MiB)                                          |
| `autoStopInterval`     | `15`                         | Provider-detected inactivity minutes; `0` disables automatic stop                      |
| `createTimeoutSeconds` | `300`                        | Sandbox create/start/delete operation timeout                                          |
| `execTimeoutSeconds`   | `300`                        | Setup commands and individual file transfers                                           |
| `requestTimeoutMs`     | `60000`                      | SDK HTTP request timeout; separate from operation deadlines                            |
| `agentEnvAllowlist`    | `[]`                         | Explicit named host provider keys to inject                                            |
| `customAgents`         | `{}`                         | Declarative terminal-agent profiles; commands run only in the sandbox                  |
| `allowCandidateAgents` | `false`                      | Explicitly opt in to custom profiles, which remain labeled unverified                  |
| `onWorktreeRemoved`    | `retain`                     | `retain`, or `confirm-delete` to request a deletion dialog                             |
| `installDependencies`  | `false`                      | Opt in to running project `npm ci` remotely; package scripts execute project code      |
| `apiUrl`               | `https://app.daytona.io/api` | Explicit HTTPS management endpoint                                                     |
| `apiKeyEnv`            | `DAYTONA_API_KEY`            | Host API-key variable name, preferred over JWT                                         |
| `jwtTokenEnv`          | `DAYTONA_JWT_TOKEN`          | Host SDK JWT variable name                                                             |
| `organizationIdEnv`    | `DAYTONA_ORGANIZATION_ID`    | Host organization variable name for JWT auth                                           |

Choose one image or snapshot; explicitly setting both fails validation. Unknown
fields and invalid settings fail before compute allocation. Timeouts do not
prove a provider request was cancelled.

Startup records the actual installed agent version. Custom images must provide
the required tools; setup failures retain the sandbox for inspection.

## Custom terminal agents

Custom profiles require explicit opt-in and remain labeled
`user-provided-unverified`. Their commands execute inside the sandbox, using
the same filtered upload, PTY, review and deletion boundaries. Profiles cannot
replace builtins and must declare interactive TTY and resume support.

```json
{
  "agent": "my-agent",
  "allowCandidateAgents": true,
  "customAgents": {
    "my-agent": {
      "title": "My Agent",
      "installationCommand": "npm install --global my-agent@1.2.3",
      "launchCommand": "my-agent",
      "versionCommand": "my-agent --version",
      "expectedVersion": "1.2.3",
      "authenticationMode": "device-code",
      "herdrDetectionIdentifier": "generic",
      "interactiveTTY": true,
      "resumeSupported": true
    }
  }
}
```

All nine profile fields are required. Detection identifiers are `generic`,
`codex`, `claude`, `opencode`, or `pi`. `authenticationMode` describes the
agent's login method; it does not copy credentials or implement login for it.
`agentArgs` remains an array of literal arguments, quoted when appended to the
configured launch command. Agent commands may run shell code remotely; never
put secret values in commands or arguments. Use the explicit environment
allowlist or log in inside the sandbox instead.

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
