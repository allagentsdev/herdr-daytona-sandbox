import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { PluginError } from "./result.mjs";

const storeError = () =>
  new PluginError(
    "credential_store",
    "Could not safely read or save local Daytona credentials.",
  );
function validKey(key) {
  return (
    typeof key === "string" && key.trim().length > 0 && !/[\r\n\0]/.test(key)
  );
}
function directory(env, create) {
  const configured = env.HERDR_PLUGIN_CONFIG_DIR;
  if (!configured && !create) return null;
  if (!configured || !path.isAbsolute(configured)) throw storeError();
  const resolved = path.resolve(configured);
  const parts = resolved
    .slice(path.parse(resolved).root.length)
    .split(path.sep)
    .filter(Boolean);
  let current = path.parse(resolved).root;
  for (const part of parts) {
    current = path.join(current, part);
    let stat;
    try {
      stat = fs.lstatSync(current);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      if (!create) return null;
      fs.mkdirSync(current, { mode: 0o700 });
      stat = fs.lstatSync(current);
    }
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw storeError();
  }
  const stat = fs.lstatSync(resolved);
  if (typeof process.getuid === "function" && stat.uid !== process.getuid())
    throw storeError();
  if (create) fs.chmodSync(resolved, 0o700);
  return resolved;
}
function readEntry(dir) {
  const file = path.join(dir, "credentials.json");
  let fd;
  try {
    if (!fs.lstatSync(file).isFile()) throw storeError();
    fd = fs.openSync(
      file,
      fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK,
    );
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
  try {
    const stat = fs.fstatSync(fd);
    if (
      !stat.isFile() ||
      stat.nlink !== 1 ||
      (stat.mode & 0o077) !== 0 ||
      (typeof process.getuid === "function" && stat.uid !== process.getuid())
    )
      throw storeError();
    const entry = JSON.parse(fs.readFileSync(fd, "utf8"));
    if (
      !entry ||
      Array.isArray(entry) ||
      entry.schemaVersion !== 1 ||
      Object.keys(entry).sort().join(",") !==
        "apiKey,apiKeyEnv,apiUrl,schemaVersion" ||
      typeof entry.apiUrl !== "string" ||
      typeof entry.apiKeyEnv !== "string" ||
      !validKey(entry.apiKey)
    )
      throw storeError();
    return entry;
  } finally {
    fs.closeSync(fd);
  }
}
export function readSavedApiKey(config, env = process.env) {
  try {
    const dir = directory(env, false);
    if (!dir) return null;
    const entry = readEntry(dir);
    if (
      !entry ||
      entry.apiUrl !== config.apiUrl ||
      entry.apiKeyEnv !== config.apiKeyEnv
    )
      return null;
    if ((fs.statSync(dir).mode & 0o077) !== 0) throw storeError();
    return entry.apiKey;
  } catch {
    throw storeError();
  }
}
export function saveApiKey(config, key, env = process.env) {
  if (!validKey(key))
    throw new PluginError(
      "invalid_api_key",
      "Enter a nonempty, single-line Daytona API key.",
    );
  let temp;
  try {
    const dir = directory(env, true);
    readEntry(dir);
    temp = path.join(dir, `.credentials.${randomUUID()}.tmp`);
    const fd = fs.openSync(
      temp,
      fs.constants.O_WRONLY |
        fs.constants.O_CREAT |
        fs.constants.O_EXCL |
        fs.constants.O_NOFOLLOW,
      0o600,
    );
    try {
      fs.writeFileSync(
        fd,
        `${JSON.stringify({ schemaVersion: 1, apiUrl: config.apiUrl, apiKeyEnv: config.apiKeyEnv, apiKey: key })}\n`,
      );
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    fs.renameSync(temp, path.join(dir, "credentials.json"));
  } catch {
    throw storeError();
  } finally {
    if (temp) {
      try {
        fs.unlinkSync(temp);
      } catch {
        /* The atomic rename already removed the temporary name. */
      }
    }
  }
}

export async function promptApiKey({
  input = process.stdin,
  output = process.stdout,
} = {}) {
  if (!input.isTTY || !output.isTTY || typeof input.setRawMode !== "function")
    throw new PluginError(
      "interactive_required",
      "A local interactive terminal is required to enter a Daytona API key.",
    );
  return new Promise((resolve, reject) => {
    let value = "";
    const wasRaw = Boolean(input.isRaw),
      wasPaused = input.isPaused();
    const cleanup = () => {
      input.removeListener("data", onData);
      input.removeListener("error", onError);
      input.removeListener("end", onEnd);
      input.setRawMode(wasRaw);
      if (wasPaused) input.pause();
      output.write("\n");
    };
    const finish = (answer, error) => {
      cleanup();
      value = "";
      if (error) reject(error);
      else resolve(answer);
    };
    const onEnd = () => finish(null);
    const onError = () =>
      finish(
        null,
        new PluginError(
          "interactive_required",
          "Could not read the local terminal.",
        ),
      );
    const onData = (chunk) => {
      const text = chunk.toString("utf8");
      if (text.includes("\x03") || text.includes("\x04")) {
        finish(null);
        return;
      }
      const newline = text.search(/[\r\n]/);
      if (newline !== -1 && !/^(?:\r\n|\r|\n)$/.test(text.slice(newline))) {
        finish(
          null,
          new PluginError(
            "invalid_api_key",
            "Enter a nonempty, single-line Daytona API key.",
          ),
        );
        return;
      }
      for (const character of text) {
        if (character === "\r" || character === "\n") {
          finish(value.length ? value : null);
          return;
        }
        if (character === "\x7f" || character === "\b") {
          if (value.length) {
            value = Array.from(value).slice(0, -1).join("");
            output.write("\b \b");
          }
        } else if (/\p{C}/u.test(character)) {
          finish(
            null,
            new PluginError(
              "invalid_api_key",
              "Enter a nonempty, single-line Daytona API key.",
            ),
          );
          return;
        } else {
          value += character;
          output.write("*");
        }
      }
    };
    try {
      input.setRawMode(true);
      input.on("data", onData);
      input.on("error", onError);
      input.on("end", onEnd);
      output.write(
        "Daytona API key (masked; Enter empty or Ctrl-C cancels) > ",
      );
      input.resume();
    } catch {
      onError();
    }
  });
}
