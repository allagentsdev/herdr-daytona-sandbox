import { PluginError } from "./result.mjs";
import { shellQuote } from "./process.mjs";

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
export function getAdapter(kind) {
  if (!Object.hasOwn(ADAPTERS, kind))
    throw new PluginError("unsupported_agent", "Unsupported agent.");
  return ADAPTERS[kind];
}
export function installCommand(adapter) {
  return `npm install --global --no-audit --no-fund --registry=https://registry.npmjs.org ${shellQuote(adapter.package)}`;
}
export function launchCommand(config) {
  const a = getAdapter(config.agent);
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
