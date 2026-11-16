import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { DaytonaProvider } from "../src/sandbox.mjs";
import { validateConfig } from "../src/config.mjs";
import { runSync } from "../src/process.mjs";
import { temporary, repository, write, git } from "./helpers.mjs";

test("actual export scanner ignores remote Git configuration/hooks and transfers bounded binary bytes", async (t) => {
  const root = repository(t),
    destination = path.join(temporary(t), "download");
  write(root, "a", "agent bytes\n");
  write(root, "odd \nfile", Buffer.from([0, 254, 128]), 0o755);
  git(root, ["add", "."]);
  git(root, ["commit", "-qm", "agent committed"]);
  const sentinel = path.join(temporary(t), "executed");
  write(
    root,
    ".git/hooks/post-checkout",
    `#!/bin/sh\ntouch '${sentinel}'\n`,
    0o755,
  );
  write(
    root,
    ".git/config",
    "[core]\nworktree = /outside\n[diff]\nexternal = touch " + sentinel + "\n",
  );
  write(root, ".gitignore", "a\n");
  write(root, ".env", "never export");
  for (const name of [".env.1", ".env.2", ".env.3"])
    write(root, name, "excluded");
  fs.symlinkSync("/etc/passwd", path.join(root, "link"));
  const box = {
    id: "box",
    state: "started",
    fs: {
      createFolder: async (p) => fs.mkdirSync(p, { mode: 0o700 }),
      uploadFile: async (bytes, p) =>
        fs.writeFileSync(p, bytes, { mode: 0o600 }),
      downloadFileStream: async (p) => fs.createReadStream(p),
    },
    process: {
      executeCommand: async (command, cwd) => {
        const r = runSync("bash", ["--noprofile", "--norc", "-c", command], {
          cwd,
          check: false,
        });
        return { exitCode: r.status, result: r.stdout };
      },
    },
  };
  const provider = new DaytonaProvider(
    { get: async () => box },
    { ...validateConfig({ maxFiles: 3 }), remoteRoot: root },
  );
  const result = await provider.exportSnapshot(
    { sandboxId: "box" },
    destination,
  );
  assert.deepEqual(
    result.files.map((f) => f.path),
    [".gitignore", "a", "odd \nfile"],
  );
  assert.deepEqual(
    fs.readFileSync(path.join(result.directory, "files", "odd \nfile")),
    Buffer.from([0, 254, 128]),
  );
  assert.equal(fs.existsSync(sentinel), false);
  assert.ok(result.excluded.some((e) => e.path === "link"));
  await assert.rejects(provider.download(box, path.join(root, "a"), 2), {
    code: "download_limit",
  });
});
