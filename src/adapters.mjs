import { PluginError } from "./result.mjs";
import { shellQuote } from "./process.mjs";
import { normalizeCustomAgentProfile } from "./config.mjs";

const ADAPTERS = Object.freeze({
  codex: {
    kind: "codex",
    detection: "codex",
    package: "@openai/codex@0.169.0",
    binary: "codex",
    version: "0.169.0",
  },
  "claude-code": {
    kind: "claude-code",
    detection: "claude",
    package: "@anthropic-ai/claude-code@2.1.325",
    binary: "claude",
    version: "2.1.325",
  },
  opencode: {
    kind: "opencode",
    detection: "opencode",
    package: "opencode-ai@1.19.5",
    binary: "opencode",
    version: "1.19.5",
  },
  pi: {
    kind: "pi",
    detection: "pi",
    package: "@mariozechner/pi-coding-agent@0.73.1",
    binary: "pi",
    version: "0.73.1",
  },
});
export function getAdapter(kind, config = {}) {
  if (Object.hasOwn(ADAPTERS, kind)) return ADAPTERS[kind];
  if (!Object.hasOwn(config.customAgents ?? {}, kind))
    throw new PluginError("unsupported_agent", "Unsupported agent.");
  if (config.allowCandidateAgents !== true)
    throw new PluginError(
      "unsupported_agent",
      "Custom agents are unverified; set allowCandidateAgents to true to start one.",
    );
  const profile = normalizeCustomAgentProfile(kind, config.customAgents[kind]);
  return Object.freeze({
    ...profile,
    kind,
    detection: profile.herdrDetectionIdentifier,
    version: profile.expectedVersion,
    supportLevel: "user-provided-unverified",
  });
}
export function installCommand(adapter) {
  if (adapter.installationCommand)
    return `set -eu\n${adapter.installationCommand}`;
  return `npm install --global --no-audit --no-fund --registry=https://registry.npmjs.org ${shellQuote(adapter.package)}`;
}
export function launchCommand(config) {
  const a = getAdapter(config.agent, config);
  if (a.launchCommand) {
    const command = [a.launchCommand, ...config.agentArgs.map(shellQuote)].join(
      " ",
    );
    return `exec bash --noprofile --norc -c ${shellQuote(command)}\n`;
  }
  const login =
    config.agent === "codex" &&
    config.agentEnvAllowlist.includes("OPENAI_API_KEY")
      ? 'if [ -n "${OPENAI_API_KEY:-}" ]; then printf \'%s\' "$OPENAI_API_KEY" | codex login --with-api-key >/dev/null || exit 1; fi; '
      : "";
  // PTY creation starts a shell. Replace it exactly once; reattach never sends this again.
  const command = `${login}exec ${[a.binary, ...config.agentArgs].map(shellQuote).join(" ")}`;
  return login
    ? `exec bash --noprofile --norc -c ${shellQuote(command)}\n`
    : `${command}\n`;
}
