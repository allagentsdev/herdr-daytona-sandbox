import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { PassThrough } from "node:stream";
import test from "node:test";
import { temporary } from "./helpers.mjs";
import { validateConfig, managementAuth } from "../src/config.mjs";
import { DaytonaProvider } from "../src/sandbox.mjs";
import {
  readSavedApiKey,
  saveApiKey,
  promptApiKey,
} from "../src/credentials.mjs";
import { connectDaytona } from "../src/connect-pane.mjs";

function fixture(t) {
  const directory = temporary(t);
  return {
    config: validateConfig({}),
    directory,
    env: {
      HERDR_PLUGIN_CONFIG_DIR: path.join(directory, "config"),
      HERDR_PLUGIN_STATE_DIR: path.join(directory, "state"),
    },
  };
}
function terminal() {
  const input = new PassThrough();
  input.isTTY = true;
  input.isRaw = false;
  input.setRawMode = (value) => {
    input.isRaw = value;
  };
  let text = "";
  const output = {
    isTTY: true,
    write: (value) => {
      text += value;
    },
  };
  return { input, output, text: () => text };
}

test("saved key is private, atomically replaced, and bound to exact endpoint and variable", (t) => {
  const { config, env } = fixture(t);
  assert.equal(readSavedApiKey(config, env), null);
  saveApiKey(config, "fixture-secret-one", env);
  const file = path.join(env.HERDR_PLUGIN_CONFIG_DIR, "credentials.json");
  assert.equal(fs.statSync(env.HERDR_PLUGIN_CONFIG_DIR).mode & 0o777, 0o700);
  assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  assert.equal(readSavedApiKey(config, env), "fixture-secret-one");
  assert.equal(
    readSavedApiKey({ ...config, apiUrl: "https://other.invalid/api" }, env),
    null,
  );
  assert.equal(
    readSavedApiKey({ ...config, apiKeyEnv: "OTHER_API_KEY" }, env),
    null,
  );
  saveApiKey(config, "fixture-secret-two", env);
  assert.equal(readSavedApiKey(config, env), "fixture-secret-two");
  assert.deepEqual(fs.readdirSync(env.HERDR_PLUGIN_CONFIG_DIR), [
    "credentials.json",
  ]);
});

test("unsafe files, malformed versions and multiline keys fail without disclosing stored secrets", (t) => {
  const { config, env, directory } = fixture(t);
  saveApiKey(config, "sensitive-fixture", env);
  const file = path.join(env.HERDR_PLUGIN_CONFIG_DIR, "credentials.json");
  const generic = (error) =>
    error.code === "credential_store" &&
    !error.message.includes("sensitive-fixture");
  fs.writeFileSync(
    file,
    JSON.stringify({ schemaVersion: 99, apiKey: "sensitive-fixture" }),
  );
  assert.throws(() => readSavedApiKey(config, env), generic);
  assert.throws(() => saveApiKey(config, "replacement", env), generic);
  fs.unlinkSync(file);
  const outside = path.join(directory, "outside");
  fs.writeFileSync(outside, "sensitive-fixture", { mode: 0o600 });
  fs.symlinkSync(outside, file);
  assert.throws(() => readSavedApiKey(config, env), generic);
  assert.throws(() => saveApiKey(config, "replacement", env), generic);
  assert.equal(fs.readFileSync(outside, "utf8"), "sensitive-fixture");
  for (const key of ["", " ", "bad\nkey", "bad\rkey", "bad\0key"])
    assert.throws(() => saveApiKey(config, key, env), {
      code: "invalid_api_key",
    });
  fs.unlinkSync(file);
  fs.rmdirSync(env.HERDR_PLUGIN_CONFIG_DIR);
  fs.symlinkSync(directory, env.HERDR_PLUGIN_CONFIG_DIR);
  assert.throws(() => saveApiKey(config, "replacement", env), generic);
});

test("masked prompt restores raw mode and supports backspace, empty Enter, and Ctrl-C", async () => {
  const tty = terminal();
  const answer = promptApiKey(tty);
  tty.input.write("fixture-secrex\x7ft\r");
  assert.equal(await answer, "fixture-secret");
  assert.ok(!tty.text().includes("fixture"));
  assert.ok(tty.text().includes("*"));
  assert.equal(tty.input.isRaw, false);
  assert.equal(tty.input.listenerCount("data"), 0);
  for (const cancel of ["\r", "private\x03"]) {
    const next = terminal();
    const pending = promptApiKey(next);
    next.input.write(cancel);
    assert.equal(await pending, null);
    assert.equal(next.input.isRaw, false);
    assert.ok(!next.text().includes("private"));
  }
});

test("prompt rejects non-TTY and pasted multiline input without echoing it", async () => {
  await assert.rejects(
    promptApiKey({ input: { isTTY: false }, output: { isTTY: true } }),
    { code: "interactive_required" },
  );
  const tty = terminal();
  const pending = promptApiKey(tty);
  tty.input.write("private\nsecond-line\n");
  await assert.rejects(pending, { code: "invalid_api_key" });
  assert.ok(!tty.text().includes("private"));
  assert.equal(tty.input.isRaw, false);
});

test("connection verifies explicit environment auth read-only without persisting it", async (t) => {
  const { env } = fixture(t);
  const tty = terminal();
  const original = DaytonaProvider.connect;
  const seen = [];
  DaytonaProvider.connect = async (config, store, authEnv) => {
    seen.push({ config, store, authEnv });
    return {
      client: {
        async *list(query) {
          assert.deepEqual(query, { limit: 1 });
          yield {};
          throw Error("must not fetch another item");
        },
      },
    };
  };
  t.after(() => {
    DaytonaProvider.connect = original;
  });
  const configuredEnv = { ...env, DAYTONA_API_KEY: "explicit-fixture" };
  assert.equal(
    await connectDaytona({ env: configuredEnv, ...tty }),
    "verified",
  );
  assert.equal(seen.length, 1);
  assert.equal(seen[0].authEnv.DAYTONA_API_KEY, "explicit-fixture");
  assert.equal(
    fs.existsSync(path.join(env.HERDR_PLUGIN_CONFIG_DIR, "credentials.json")),
    false,
  );
  assert.ok(!tty.text().includes("explicit-fixture"));
});

test("connection saves only an SDK-verified candidate and redacts rejected SDK errors", async (t) => {
  const { config, env } = fixture(t);
  const tty = terminal();
  const original = DaytonaProvider.connect;
  const seen = [];
  DaytonaProvider.connect = async (_config, _store, authEnv) => ({
    client: {
      async *list() {
        seen.push(authEnv.DAYTONA_API_KEY);
        if (authEnv.DAYTONA_API_KEY === "rejected-fixture")
          throw Object.assign(Error("Authorization Bearer rejected-fixture"), {
            statusCode: 401,
          });
        yield {};
      },
    },
  });
  t.after(() => {
    DaytonaProvider.connect = original;
  });
  const pending = connectDaytona({
    env: { ...env, DAYTONA_API_KEY: "rejected-fixture" },
    ...tty,
  });
  await new Promise((resolve) => setImmediate(resolve));
  tty.input.write("verified-fixture\r");
  assert.equal(await pending, "connected");
  assert.deepEqual(seen, ["rejected-fixture", "verified-fixture"]);
  assert.equal(readSavedApiKey(config, env), "verified-fixture");
  assert.ok(tty.text().includes("https://app.daytona.io/dashboard/keys"));
  assert.ok(tty.text().includes("precedence"));
  assert.ok(!tty.text().includes("rejected-fixture"));
  assert.ok(!tty.text().includes("verified-fixture"));
  assert.ok(!tty.text().includes("Authorization"));
});

test("rejected candidate is never saved and raw provider error never escapes", async (t) => {
  const { env } = fixture(t);
  const tty = terminal();
  const original = DaytonaProvider.connect;
  DaytonaProvider.connect = async () => {
    throw Error("Authorization Bearer private-fixture");
  };
  t.after(() => {
    DaytonaProvider.connect = original;
  });
  const pending = connectDaytona({ env, ...tty });
  await new Promise((resolve) => setImmediate(resolve));
  tty.input.write("private-fixture\r");
  await assert.rejects(
    pending,
    (error) =>
      error.code === "provider_request" &&
      !error.message.includes("private-fixture"),
  );
  assert.equal(
    fs.existsSync(path.join(env.HERDR_PLUGIN_CONFIG_DIR, "credentials.json")),
    false,
  );
  assert.ok(!tty.text().includes("private-fixture"));
});

test("management auth uses matching saved key after explicit environment authentication", (t) => {
  const { config, env } = fixture(t);
  saveApiKey(config, "saved-fixture", env);
  assert.equal(managementAuth(config, env).apiKey, "saved-fixture");
  assert.equal(
    managementAuth(config, { ...env, DAYTONA_API_KEY: "environment-fixture" })
      .apiKey,
    "environment-fixture",
  );
  const jwt = managementAuth(config, {
    ...env,
    DAYTONA_JWT_TOKEN: "jwt-fixture",
    DAYTONA_ORGANIZATION_ID: "organization-fixture",
  });
  assert.equal(jwt.jwtToken, "jwt-fixture");
  assert.equal(jwt.apiKey, undefined);
  assert.throws(
    () =>
      managementAuth({ ...config, apiUrl: "https://other.invalid/api" }, env),
    { code: "missing_auth" },
  );
});
