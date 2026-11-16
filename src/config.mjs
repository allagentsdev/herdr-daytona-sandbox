import fs from "node:fs";
import path from "node:path";
import { AGENTS } from "./constants.mjs";
import { PluginError } from "./result.mjs";

export const DEFAULT_CONFIG = Object.freeze({
  agent: "codex",
  agentArgs: [],
  region: "eu",
  image: "node:22.22.0-bookworm",
  snapshot: null,
  remoteRoot: "/workspace",
  excludedPaths: [],
  maxFiles: 10000,
  maxFileBytes: 10 * 1024 * 1024,
  maxUploadBytes: 100 * 1024 * 1024,
  autoStopInterval: 15,
  createTimeoutSeconds: 300,
  execTimeoutSeconds: 300,
  requestTimeoutMs: 60000,
  agentEnvAllowlist: [],
  onWorktreeRemoved: "retain",
  installDependencies: false,
  apiUrl: "https://app.daytona.io/api",
  apiKeyEnv: "DAYTONA_API_KEY",
  jwtTokenEnv: "DAYTONA_JWT_TOKEN",
  organizationIdEnv: "DAYTONA_ORGANIZATION_ID",
});
const invalid = (message) => {
  throw new PluginError("invalid_config", message);
};
const literalString = (v) => typeof v === "string" && !v.includes("\0");
export function safeRelative(p) {
  return (
    literalString(p) &&
    p.length > 0 &&
    !p.includes("\\") &&
    !p.startsWith("/") &&
    p.split("/").every((v) => v && v !== "." && v !== "..")
  );
}
export function validateConfig(candidate) {
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate))
    invalid("config.json must contain an object.");
  if (Object.keys(candidate).some((k) => !Object.hasOwn(DEFAULT_CONFIG, k)))
    invalid("Unknown config field.");
  const c = { ...DEFAULT_CONFIG, ...candidate };
  if (candidate.snapshot && !Object.hasOwn(candidate, "image")) c.image = null;
  if (!AGENTS.includes(c.agent)) invalid("Unsupported agent.");
  for (const k of ["agentArgs", "excludedPaths", "agentEnvAllowlist"])
    if (!Array.isArray(c[k]) || !c[k].every(literalString))
      invalid(`${k} must be an array of literal strings.`);
  if (
    c.excludedPaths.some(
      (p) => !safeRelative(p.replace(/\/$/, "")) || /[?*[\]]/.test(p),
    )
  )
    invalid("excludedPaths must contain literal repository-relative paths.");
  if (
    c.agentEnvAllowlist.some(
      (k) =>
        !/^([A-Z][A-Z0-9_]*(?:_API_KEY|_TOKEN)|AWS_ACCESS_KEY_ID|AWS_SECRET_ACCESS_KEY)$/.test(
          k,
        ) ||
        k.startsWith("DAYTONA_") ||
        [c.apiKeyEnv, c.jwtTokenEnv, c.organizationIdEnv].includes(k),
    )
  )
    invalid(
      "agentEnvAllowlist accepts named provider keys only; management credentials are forbidden.",
    );
  for (const k of [
    "maxFiles",
    "maxFileBytes",
    "maxUploadBytes",
    "createTimeoutSeconds",
    "execTimeoutSeconds",
    "requestTimeoutMs",
  ])
    if (!Number.isSafeInteger(c[k]) || c[k] <= 0)
      invalid(`${k} must be a positive integer.`);
  if (!Number.isSafeInteger(c.autoStopInterval) || c.autoStopInterval < 0)
    invalid("autoStopInterval must be a nonnegative integer in minutes.");
  for (const k of [
    "region",
    "remoteRoot",
    "apiUrl",
    "apiKeyEnv",
    "jwtTokenEnv",
    "organizationIdEnv",
  ])
    if (!literalString(c[k]) || !c[k])
      invalid(`${k} must be a nonempty string.`);
  for (const k of ["apiKeyEnv", "jwtTokenEnv", "organizationIdEnv"])
    if (!/^[A-Z][A-Z0-9_]*$/.test(c[k]))
      invalid(`${k} must name a host environment variable.`);
  if (
    Boolean(c.image) === Boolean(c.snapshot) ||
    [c.image, c.snapshot].some((v) => v !== null && (!literalString(v) || !v))
  )
    invalid("Choose exactly one image or snapshot.");
  if (
    path.posix.normalize(c.remoteRoot) !== c.remoteRoot ||
    (c.remoteRoot !== "/workspace" && !c.remoteRoot.startsWith("/workspace/"))
  )
    invalid("remoteRoot must be /workspace or a normalized path below it.");
  if (!["retain", "confirm-delete"].includes(c.onWorktreeRemoved))
    invalid("onWorktreeRemoved must be retain or confirm-delete.");
  if (typeof c.installDependencies !== "boolean")
    invalid("installDependencies must be boolean.");
  let url;
  try {
    url = new URL(c.apiUrl);
  } catch {
    invalid("apiUrl must be an HTTPS URL.");
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    invalid("apiUrl must be an HTTPS URL without embedded credentials.");
  return c;
}
export function loadConfig(env = process.env) {
  if (!env.HERDR_PLUGIN_CONFIG_DIR)
    throw new PluginError(
      "missing_plugin_config_dir",
      "HERDR_PLUGIN_CONFIG_DIR is required.",
    );
  const file = path.join(env.HERDR_PLUGIN_CONFIG_DIR, "config.json");
  if (!fs.existsSync(file)) return validateConfig({});
  let c;
  try {
    c = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    invalid("Could not parse plugin config.json.");
  }
  return validateConfig(c);
}
export function managementAuth(c, env = process.env) {
  const base = {
    apiUrl: c.apiUrl,
    target: c.region,
    requestTimeoutMs: c.requestTimeoutMs,
    otelEnabled: false,
  };
  const apiKey = env[c.apiKeyEnv];
  if (apiKey) return { ...base, apiKey };
  const jwtToken = env[c.jwtTokenEnv],
    organizationId = env[c.organizationIdEnv];
  if (jwtToken && organizationId) return { ...base, jwtToken, organizationId };
  throw new PluginError(
    "missing_auth",
    "Set the configured Daytona API-key environment variable, or both JWT and organization variables. CLI login alone is not supported.",
  );
}
export function agentEnvironment(c, env = process.env) {
  if (c.agentEnvAllowlist.some((k) => !env[k]))
    throw new PluginError(
      "missing_agent_env",
      "An explicitly allowlisted provider key is missing from the host environment.",
    );
  return Object.fromEntries(
    c.agentEnvAllowlist.filter((k) => env[k]).map((k) => [k, env[k]]),
  );
}
