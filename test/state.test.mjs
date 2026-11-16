import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync, spawn } from "node:child_process";
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

test("separate processes serialize action recovery and state writes after a dead owner", async (t) => {
  const directory = fs.realpathSync(
      fs.mkdtempSync(path.join(os.tmpdir(), "daytona-workers-")),
    ),
    store = new Store(directory),
    id = crypto.randomUUID();
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  await store.create({
    id,
    namespace: "n",
    localRoot: "/tmp",
    phase: "ready",
    n: 0,
  });
  const dead = spawnSync(process.execPath, ["-e", ""]);
  fs.writeFileSync(`${store.file(id)}.operation.lock`, String(dead.pid));
  const module = new URL("../src/state.mjs", import.meta.url).href;
  const script = `import fs from 'node:fs';import {setTimeout} from 'node:timers/promises';import {Store} from ${JSON.stringify(module)};const s=new Store(process.argv[1]),id=process.argv[2],active=s.directory+'/active';for(let i=0;i<4;i++)await s.withLock(id,async()=>{const fd=fs.openSync(active,'wx');try{await setTimeout(5);await s.update(id,r=>({...r,n:r.n+1}));}finally{fs.closeSync(fd);fs.unlinkSync(active);}});`;
  await Promise.all(
    Array.from(
      { length: 3 },
      () =>
        new Promise((resolve, reject) => {
          const child = spawn(
            process.execPath,
            ["--input-type=module", "-e", script, directory, id],
            { stdio: ["ignore", "ignore", "pipe"] },
          );
          let error = "";
          child.stderr.on("data", (b) => {
            error += b;
          });
          child.on("error", reject);
          child.on("exit", (code) =>
            code === 0 ? resolve() : reject(Error(error)),
          );
        }),
    ),
  );
  assert.equal(store.get(id).n, 12);
  assert.equal(fs.existsSync(path.join(directory, "active")), false);
});

test("a stale-lock contender never unlinks a replacement live owner", async (t) => {
  const store = new Store(
      fs.mkdtempSync(path.join(os.tmpdir(), "daytona-lock-")),
    ),
    id = crypto.randomUUID();
  t.after(() => fs.rmSync(store.directory, { recursive: true, force: true }));
  const dead = spawnSync(process.execPath, ["-e", ""]);
  const lock = `${store.file(id)}.operation.lock`;
  fs.writeFileSync(lock, String(dead.pid), { mode: 0o600 });
  const read = fs.readFileSync;
  let replaced = false,
    entered = false;
  t.mock.method(fs, "readFileSync", (file, ...args) => {
    const result = read(file, ...args);
    if (file === lock && !replaced) {
      replaced = true;
      fs.writeFileSync(lock, String(process.pid));
    }
    return result;
  });
  await assert.rejects(
    store.withLock(
      id,
      () => {
        entered = true;
      },
      { attempts: 2, interval: 0 },
    ),
    { code: "association_busy" },
  );
  assert.equal(entered, false);
  assert.equal(read(lock, "utf8"), String(process.pid));
});
