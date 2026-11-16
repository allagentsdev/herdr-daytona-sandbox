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
    assert.deepEqual(c.customAgents, {});
    assert.equal(c.allowCandidateAgents, false);
  }
});
const customProfile = {
  title: " My Agent ",
  installationCommand: "npm install --global my-agent@1.2.3",
  launchCommand: "my-agent --interactive",
  versionCommand: "my-agent version",
  expectedVersion: " 1.2.3 ",
  authenticationMode: " device-code ",
  herdrDetectionIdentifier: "generic",
  interactiveTTY: true,
  resumeSupported: true,
};
test("custom profiles require explicit opt-in and normalize declarative metadata", () => {
  const customAgents = { "my-agent": customProfile };
  const c = validateConfig({
    agent: "my-agent",
    customAgents,
    allowCandidateAgents: true,
  });
  assert.equal(c.agent, "my-agent");
  assert.equal(c.customAgents["my-agent"].title, "My Agent");
  assert.equal(c.customAgents["my-agent"].expectedVersion, "1.2.3");
  assert.equal(c.customAgents["my-agent"].authenticationMode, "device-code");
  assert.equal(
    c.customAgents["my-agent"].launchCommand,
    customProfile.launchCommand,
  );
  assert.throws(() => validateConfig({ agent: "my-agent", customAgents }), {
    code: "invalid_config",
  });
  assert.doesNotThrow(() => validateConfig({ customAgents }));
});
test("malformed profiles fail before allocation, including unused definitions", () => {
  const invalidProfiles = [
    null,
    [],
    {},
    { ...customProfile, extra: true },
    ...Object.keys(customProfile).map((key) => {
      const p = { ...customProfile };
      delete p[key];
      return p;
    }),
    { ...customProfile, title: "  " },
    { ...customProfile, installationCommand: "echo\0bad" },
    { ...customProfile, herdrDetectionIdentifier: "unknown-agent" },
    { ...customProfile, interactiveTTY: "true" },
    { ...customProfile, resumeSupported: 1 },
    { ...customProfile, interactiveTTY: false },
    { ...customProfile, resumeSupported: false },
  ];
  for (const profile of invalidProfiles) {
    assert.throws(
      () =>
        validateConfig({
          customAgents: { "my-agent": profile },
          allowCandidateAgents: true,
        }),
      { code: "invalid_config" },
    );
  }
  for (const customAgents of [
    null,
    [],
    "./host-profile.mjs",
    { "Bad Name": customProfile },
    { codex: customProfile },
    { pi: customProfile },
  ]) {
    assert.throws(
      () => validateConfig({ customAgents, allowCandidateAgents: true }),
      { code: "invalid_config" },
    );
  }
  assert.throws(() => validateConfig({ allowCandidateAgents: "true" }), {
    code: "invalid_config",
  });
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
