import assert from "node:assert/strict";
import test from "node:test";
import {
  validateConfig,
  managementAuth,
  agentEnvironment,
} from "../src/config.mjs";

test("persistent defaults and all four agents", () => {
  for (const agent of ["codex", "claude-code", "opencode", "pi"]) {
    const c = validateConfig({ agent });
    assert.equal(c.autoStopInterval, 15);
    assert.equal(c.region, "eu");
    assert.deepEqual(c.agentEnvAllowlist, []);
  }
});
test("invalid config fails before allocation", () => {
  for (const c of [
    { agent: "other" },
    { agentArgs: "--x" },
    { autoStopInterval: -1 },
    { image: "x", snapshot: "y" },
    { remoteRoot: "/workspace/../etc" },
    { excludedPaths: ["../a"] },
    { excludedPaths: ["*.key"] },
    { agentEnvAllowlist: ["DAYTONA_API_KEY"] },
    { agentEnvAllowlist: ["BASH_ENV"] },
    { maxUploadBytes: 0 },
    { requestTimeoutMs: Infinity },
    { ttlMinutes: 30 },
  ]) {
    assert.throws(() => validateConfig(c));
  }
});
test("credentials are explicit, API key preferred, injection opt in", () => {
  const c = validateConfig({});
  assert.throws(() => managementAuth(c, {}), { code: "missing_auth" });
  const env = {
    DAYTONA_API_KEY: "control",
    DAYTONA_JWT_TOKEN: "jwt",
    DAYTONA_ORGANIZATION_ID: "org",
    OPENAI_API_KEY: "agent",
  };
  assert.equal(managementAuth(c, env).apiKey, "control");
  assert.deepEqual(agentEnvironment(c, env), {});
  assert.deepEqual(
    agentEnvironment(
      validateConfig({ agentEnvAllowlist: ["OPENAI_API_KEY"] }),
      env,
    ),
    { OPENAI_API_KEY: "agent" },
  );
  assert.equal(
    managementAuth(c, { DAYTONA_JWT_TOKEN: "j", DAYTONA_ORGANIZATION_ID: "o" })
      .organizationId,
    "o",
  );
});
