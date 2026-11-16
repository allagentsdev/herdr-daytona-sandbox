import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { preparePatch, applyReviewedPatch } from "../src/patch.mjs";
import { captureSnapshot, saveSnapshot, digest } from "../src/manifest.mjs";
import { validateConfig } from "../src/config.mjs";
import { Store } from "../src/state.mjs";
import { repository, temporary, write, git } from "./helpers.mjs";

async function fixture(t) {
  const root = repository(t);
  write(root, "a", "original\n");
  write(root, "remove", "old\n");
  write(root, "mode", "echo hi\n");
  git(root, ["add", "."]);
  git(root, ["commit", "-qm", "base"]);
  write(root, "a", "local starting edit\n");
  const store = new Store(temporary(t)),
    id = randomUUID(),
    config = validateConfig({});
  const base = captureSnapshot(
    root,
    config,
    path.join(store.artifacts(id), "baseline"),
  );
  const stat = fs.statSync(root);
  await store.create({
    id,
    namespace: "test",
    localRoot: root,
    localCwd: root,
    rootIdentity: { dev: stat.dev, ino: stat.ino },
    sandboxId: "box",
    config,
    phase: "ready",
    baseline: base.directory,
    baselineDigest: base.digest,
    checkpoint: base.directory,
    checkpointDigest: base.digest,
  });
  const remote = repository(t);
  for (const f of base.files)
    write(
      remote,
      f.path,
      fs.readFileSync(path.join(base.directory, "files", f.path)),
      f.mode === "100755" ? 0o755 : 0o644,
    );
  git(remote, ["add", "."]);
  git(remote, ["commit", "-qm", "uploaded"]);
  const provider = {
    get: async () => ({ state: "started" }),
    exportSnapshot: async (record, directory) =>
      captureSnapshot(remote, config, directory),
  };
  return { root, remote, store, id, provider, base };
}
test("dirty baseline, committed agent edits, binary/add/delete/modes, cancel/repeat/incremental round trip", async (t) => {
  const f = await fixture(t),
    { root, remote, store, id, provider } = f;
  write(remote, "a", "agent change on local starting edit\n");
  write(remote, "binary", Buffer.from([0, 255, 3]));
  fs.unlinkSync(path.join(remote, "remove"));
  fs.chmodSync(path.join(remote, "mode"), 0o755);
  git(remote, ["add", "."]);
  git(remote, ["commit", "-qm", "agent committed"]);
  const index = git(root, ["diff", "--cached", "--binary"]).stdout;
  const preview = await preparePatch(store, id, provider);
  assert.equal(
    fs.readFileSync(path.join(root, "a"), "utf8"),
    "local starting edit\n",
  );
  assert.equal(store.get(id).checkpoint, f.base.directory); // Cancel is simply no approval.
  await applyReviewedPatch(store, id, preview.artifact, preview.digest);
  assert.equal(
    fs.readFileSync(path.join(root, "a"), "utf8"),
    "agent change on local starting edit\n",
  );
  assert.deepEqual(
    fs.readFileSync(path.join(root, "binary")),
    Buffer.from([0, 255, 3]),
  );
  assert.equal(fs.existsSync(path.join(root, "remove")), false);
  assert.ok(fs.statSync(path.join(root, "mode")).mode & 0o111);
  assert.equal(git(root, ["diff", "--cached", "--binary"]).stdout, index);
  assert.equal((await preparePatch(store, id, provider)).status, "no_change");
  write(remote, "a", "second agent edit\n");
  const next = await preparePatch(store, id, provider);
  await applyReviewedPatch(store, id, next.artifact, next.digest);
  assert.equal(
    fs.readFileSync(path.join(root, "a"), "utf8"),
    "second agent edit\n",
  );
});
test("tampered artifact, stale destination, conflicts and symlink parents reject without checkpoint advance", async (t) => {
  const { root, remote, store, id, provider, base } = await fixture(t);
  write(remote, "a", "remote\n");
  const candidate = await preparePatch(store, id, provider);
  fs.appendFileSync(candidate.patchPath, "\nmalicious");
  await assert.rejects(
    applyReviewedPatch(store, id, candidate.artifact, candidate.digest),
    { code: "artifact_changed" },
  );
  const clean = await preparePatch(store, id, provider);
  write(root, "a", "new local overlap\n");
  await assert.rejects(
    applyReviewedPatch(store, id, clean.artifact, clean.digest),
    { code: "patch_conflict" },
  );
  assert.equal(store.get(id).checkpoint, base.directory);
  write(root, "a", "local starting edit\n");
  write(remote, "link/escape", "attack");
  const symlink = await preparePatch(store, id, provider);
  const outside = temporary(t);
  fs.symlinkSync(outside, path.join(root, "link"));
  await assert.rejects(
    applyReviewedPatch(store, id, symlink.artifact, symlink.digest),
    { code: "symlink_path" },
  );
  assert.equal(fs.existsSync(path.join(outside, "escape")), false);
  fs.unlinkSync(path.join(root, "link"));
  const old = `${root}-old`;
  fs.renameSync(root, old);
  t.after(() => fs.rmSync(old, { recursive: true, force: true }));
  fs.mkdirSync(root);
  await assert.rejects(
    applyReviewedPatch(store, id, clean.artifact, clean.digest),
    { code: "destination_changed" },
  );
});
test("remote metadata and patch bytes cannot introduce escaping, excluded, or symlink paths", async (t) => {
  const f = await fixture(t);
  f.provider.exportSnapshot = async (r, directory) =>
    saveSnapshot(directory, [
      { path: ".git/config", bytes: Buffer.from("attack"), mode: "100644" },
    ]);
  await assert.rejects(preparePatch(f.store, f.id, f.provider), {
    code: "excluded_patch_path",
  });
  write(f.remote, "a", "remote");
  f.provider.exportSnapshot = async (r, directory) =>
    captureSnapshot(f.remote, validateConfig({}), directory);
  const p = await preparePatch(f.store, f.id, f.provider);
  const bad = Buffer.from(
    "diff --git a/a b/../../outside\n--- a/a\n+++ b/../../outside\n@@ -1 +1 @@\n-local starting edit\n+attack\n",
  );
  fs.writeFileSync(p.patchPath, bad);
  const metadata = JSON.parse(fs.readFileSync(p.metadataPath, "utf8"));
  metadata.digest = digest(bad);
  fs.writeFileSync(p.metadataPath, JSON.stringify(metadata));
  await assert.rejects(
    applyReviewedPatch(f.store, f.id, p.artifact, digest(bad)),
    { code: "artifact_changed" },
  );
});

test("successful apply recovers its checkpoint after a failed state write without replaying changes", async (t) => {
  const { root, remote, store, id, provider, base } = await fixture(t);
  write(remote, "a", "approved remote edit\n");
  const candidate = await preparePatch(store, id, provider);
  const rename = fs.renameSync;
  let writes = 0;
  const mock = t.mock.method(fs, "renameSync", (source, target) => {
    if (target === store.file(id) && ++writes === 2)
      throw Object.assign(Error("disk failure"), { code: "EIO" });
    return rename(source, target);
  });
  await assert.rejects(
    applyReviewedPatch(store, id, candidate.artifact, candidate.digest),
  );
  assert.equal(
    fs.readFileSync(path.join(root, "a"), "utf8"),
    "approved remote edit\n",
  );
  assert.equal(store.get(id).checkpoint, base.directory);
  assert.equal(store.get(id).pendingApply.artifact, candidate.artifact);
  mock.mock.restore();
  assert.equal((await preparePatch(store, id, provider)).status, "no_change");
  assert.notEqual(store.get(id).checkpoint, base.directory);
  assert.equal(store.get(id).pendingApply, null);
});
