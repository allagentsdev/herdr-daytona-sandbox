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
