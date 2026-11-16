import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Store, namespace } from "../src/state.mjs";

test("associations survive concurrent writes and isolate recurring pane IDs", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "daytona-state-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const s = new Store(dir);
  const a = namespace({ HERDR_SOCKET_PATH: "/s/a", HERDR_SESSION: "one" });
  const b = namespace({ HERDR_SOCKET_PATH: "/s/a", HERDR_SESSION: "two" });
  assert.notEqual(a, b);
  await Promise.all(
    Array.from({ length: 12 }, (_, i) =>
      s.create({
        id: crypto.randomUUID(),
        namespace: i % 2 ? a : b,
        remotePaneId: "w1:p1",
        localRoot: "/tmp/root",
        phase: "provisional",
      }),
    ),
  );
  assert.equal(s.list().length, 12);
  const first = s.list()[0];
  await Promise.all(
    Array.from({ length: 8 }, () =>
      s.update(first.id, (r) => ({ ...r, n: (r.n ?? 0) + 1 })),
    ),
  );
  assert.equal(s.get(first.id).n, 8);
  assert.equal(fs.statSync(s.file(first.id)).mode & 0o777, 0o600);
  await assert.rejects(
    s.withLock(first.id, () => s.withLock(first.id, () => {}, { attempts: 1 })),
    { code: "association_busy" },
  );
});
