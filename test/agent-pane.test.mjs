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

test("uncertain initial PTY launch is reattached without resending its command", async (t) => {
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
  let sent = 0,
    connected = 0;
  const handle = {
    sendInput: async () => {
      sent++;
      throw Error("lost reply");
    },
    disconnect: async () => {},
    resize: async () => {},
    wait: async () => ({ exitCode: 0 }),
  };
  const box = {
    state: "started",
    process: {
      createPty: async () => handle,
      getPtySessionInfo: async () => ({ active: true }),
      connectPty: async () => {
        connected++;
        return handle;
      },
    },
  };
  const provider = {
    get: async () => box,
    resume: async () => box,
    environment: () => ({}),
  };
  const io = {
    input: new PassThrough(),
    output: new PassThrough(),
    signals: new EventEmitter(),
  };
  await assert.rejects(attachAgent(store, id, provider, io));
  assert.equal(store.get(id).ptyPhase, "launching");
  await attachAgent(store, id, provider, io);
  assert.equal(connected, 1);
  assert.equal(sent, 1);
});

test("an active creating-phase PTY completes its first launch once", async (t) => {
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
    ptyId: "surviving-shell",
    ptyPhase: "creating",
  });
  let sent = 0,
    connected = 0;
  const handle = {
    sendInput: async () => {
      sent++;
    },
    disconnect: async () => {},
    resize: async () => {},
    wait: async () => ({ exitCode: 0 }),
  };
  const box = {
    state: "started",
    process: {
      createPty: async () => {
        throw Error("must reuse");
      },
      getPtySessionInfo: async () => ({ active: true }),
      connectPty: async () => {
        connected++;
        return handle;
      },
    },
  };
  const provider = {
    get: async () => box,
    resume: async () => box,
    environment: () => ({}),
  };
  const io = {
    input: new PassThrough(),
    output: new PassThrough(),
    signals: new EventEmitter(),
  };
  await attachAgent(store, id, provider, io);
  await attachAgent(store, id, provider, io);
  assert.equal(store.get(id).ptyPhase, "launched");
  assert.equal(sent, 1);
  assert.equal(connected, 2);
});

test("failed agent exit and unresolved transport loss are reported after terminal cleanup", async (t) => {
  for (const result of [
    { exitCode: 7 },
    {},
    { exitCode: 0, error: "untrusted diagnostic" },
  ]) {
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
    let disconnected = false,
      raw = false;
    const handle = {
      sendInput: async () => {},
      disconnect: async () => {
        disconnected = true;
      },
      resize: async () => {},
      wait: async () => result,
    };
    const box = {
      state: "started",
      process: { createPty: async () => handle },
    };
    const provider = {
      get: async () => box,
      resume: async () => box,
      environment: () => ({}),
    };
    const input = new PassThrough();
    input.isTTY = true;
    input.setRawMode = (v) => {
      raw = v;
    };
    await assert.rejects(
      attachAgent(store, id, provider, {
        input,
        output: new PassThrough(),
        signals: new EventEmitter(),
      }),
      (e) => {
        assert.equal(
          e.code,
          result.exitCode === 7 ? "agent_exit" : "pty_transport",
        );
        if (result.exitCode === 7) assert.equal(e.exitCode, 7);
        assert.doesNotMatch(e.message, /untrusted diagnostic/);
        return true;
      },
    );
    assert.equal(raw, false);
    assert.equal(disconnected, true);
    assert.equal(store.get(id).phase, "detached");
  }
});
