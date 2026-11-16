import test from "node:test";
import assert from "node:assert/strict";
import { getAdapter, launchCommand, installCommand } from "../src/adapters.mjs";
import { validateConfig } from "../src/config.mjs";
import { runSync } from "../src/process.mjs";
import { temporary, write } from "./helpers.mjs";
test("all agent adapters pin distinct packages, keep literal argv and never forward ambient keys", (t) => {
  const dir = temporary(t);
  write(dir, "codex", '#!/bin/sh\nprintf "%s\\0" "$@"\n', 0o755);
  const args = [
    "space value",
    "single'quote",
    "$(touch /never-execute)",
    "line\nbreak",
    "",
  ];
  const result = runSync(
    "bash",
    [
      "--noprofile",
      "--norc",
      "-c",
      launchCommand(validateConfig({ agentArgs: args })),
    ],
    { env: { PATH: `${dir}:/usr/bin:/bin` } },
  );
  assert.deepEqual(result.stdout.split("\0").slice(0, -1), args);
  for (const kind of ["codex", "claude-code", "opencode", "pi"]) {
    const a = getAdapter(kind);
    assert.match(a.package, /@\d+\.\d+\.\d+$/);
    assert.ok(installCommand(a).includes(a.package));
  }
  assert.throws(() => getAdapter("other"));
});
test("custom adapters stay unverified and build remote shell commands with literal argv", (t) => {
  const dir = temporary(t);
  const marker = `${dir}/must-not-run-on-host`;
  const profile = {
    title: "Example Agent",
    installationCommand: `touch '${marker}'`,
    launchCommand: "printf '%s\\0' 'fixed arg'",
    versionCommand: `touch '${marker}'; printf '1.2.3'`,
    expectedVersion: "1.2.3",
    authenticationMode: "device-code",
    herdrDetectionIdentifier: "generic",
    interactiveTTY: true,
    resumeSupported: true,
  };
  const args = [
    "single'quote",
    "space value",
    `$(touch '${marker}')`,
    "line\nbreak",
    "",
  ];
  const c = validateConfig({
    agent: "my-agent",
    customAgents: { "my-agent": profile },
    allowCandidateAgents: true,
    agentArgs: args,
  });
  const a = getAdapter(c.agent, c);
  assert.equal(a.detection, "generic");
  assert.equal(a.version, "1.2.3");
  assert.equal(a.versionCommand, profile.versionCommand);
  assert.equal(a.supportLevel, "user-provided-unverified");
  assert.equal(a.authenticationMode, "device-code");
  assert.equal(a.interactiveTTY, true);
  assert.equal(a.resumeSupported, true);
  assert.match(installCommand(a), /touch/);
  assert.equal(
    runSync("test", ["!", "-e", marker], { check: false }).status,
    0,
  );
  const result = runSync("bash", [
    "--noprofile",
    "--norc",
    "-c",
    launchCommand(c),
  ]);
  assert.deepEqual(result.stdout.split("\0").slice(0, -1), [
    "fixed arg",
    ...args,
  ]);
  assert.equal(
    runSync("test", ["!", "-e", marker], { check: false }).status,
    0,
  );
  assert.throws(() =>
    getAdapter(c.agent, { ...c, allowCandidateAgents: false }),
  );
});
