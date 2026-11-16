import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { randomUUID } from "node:crypto";
import { attachAgent } from "../src/terminal.mjs";
import { Store } from "../src/state.mjs";
import { validateConfig } from "../src/config.mjs";
import { temporary } from "./helpers.mjs";

test("PTY launches once, forwards binary input/resize, reattaches, restores raw mode and disconnects without kill", async (t) => {
  const store = new Store(temporary(t)),
    id = randomUUID(),
    config = validateConfig({});
  await store.create({
    id,
    namespace: "n",
    localRoot: "/tmp",
    relativeCwd: ".",
    phase: "ready",
    sandboxId: "box",
    config,
  });
  const input = new PassThrough(),
    output = new PassThrough(),
    signals = new EventEmitter();
  input.isTTY = true;
  let raw = false;
  input.setRawMode = (v) => {
    raw = v;
  };
  output.columns = 100;
  output.rows = 32;
  const sent = [],
    sizes = [];
  let creates = 0,
    connects = 0,
    disconnects = 0,
    onData,
    finish;
  let done = new Promise((r) => {
    finish = r;
  });
  const handle = {
    sendInput: async (v) => {
      sent.push(v);
    },
    resize: async (...v) => sizes.push(v),
    disconnect: async () => {
      disconnects++;
    },
    wait: () => done,
  };
  const box = {
    state: "started",
    process: {
      getPtySessionInfo: async () => ({ active: true }),
      createPty: async (opts) => {
        creates++;
        onData = opts.onData;
        return handle;
      },
      connectPty: async (id, opts) => {
        connects++;
        onData = opts.onData;
        return handle;
      },
    },
  };
  const provider = {
    get: async () => box,
    resume: async () => box,
    environment: () => ({}),
  };
  const first = attachAgent(store, id, provider, { input, output, signals });
  while (!raw) await new Promise((r) => setImmediate(r));
  input.write(Buffer.from([0, 3, 255]));
  onData(Buffer.from("hello 世界"));
  output.emit("resize");
  signals.emit("SIGTERM");
  await first;
  assert.equal(raw, false);
  assert.equal(creates, 1);
  assert.equal(disconnects, 1);
  assert.equal(input.listenerCount("data"), 0);
  assert.ok(sent.some((v) => typeof v === "string" && v.startsWith("exec ")));
  assert.ok(
    sent.some((v) => Buffer.isBuffer(v) && v.equals(Buffer.from([0, 3, 255]))),
  );
  assert.deepEqual(sizes.at(-1), [100, 32]);
  done = new Promise((r) => {
    finish = r;
  });
  const second = attachAgent(store, id, provider, { input, output, signals });
  while (!raw) await new Promise((r) => setImmediate(r));
  finish({ exitCode: 0 });
  await second;
  assert.equal(connects, 1);
  assert.equal(creates, 1);
  assert.equal(sent.filter((v) => typeof v === "string").length, 1);
  assert.equal(raw, false);
  assert.equal(disconnects, 2);
  assert.equal(signals.listenerCount("SIGTERM"), 0);
});
