import fs from "node:fs";
import path from "node:path";
import { randomUUID, createHash } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { PluginError } from "./result.mjs";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export function namespace(env = process.env) {
  return createHash("sha256")
    .update(
      JSON.stringify([
        env.HERDR_SOCKET_PATH ?? env.HERDR_SOCKET ?? "",
        env.HERDR_SESSION ??
          env.HERDR_SESSION_NAME ??
          env.HERDR_REMOTE_SESSION ??
          "default",
      ]),
    )
    .digest("hex");
}
export function atomicJson(file, value) {
  const temp = `${file}.${randomUUID()}.tmp`;
  try {
    fs.writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`, {
      mode: 0o600,
      flag: "wx",
    });
    fs.renameSync(temp, file);
  } finally {
    fs.rmSync(temp, { force: true });
  }
}
export class Store {
  constructor(directory = process.env.HERDR_PLUGIN_STATE_DIR) {
    if (!directory || !path.isAbsolute(directory))
      throw new PluginError(
        "missing_plugin_state_dir",
        "An absolute HERDR_PLUGIN_STATE_DIR is required.",
      );
    this.directory = directory;
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    fs.chmodSync(directory, 0o700);
  }
  file(id) {
    if (!UUID.test(id))
      throw new PluginError("invalid_association", "Invalid association ID.");
    return path.join(this.directory, `${id}.json`);
  }
  artifacts(id) {
    this.file(id);
    const dir = path.join(this.directory, id);
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    return dir;
  }
  get(id) {
    const r = JSON.parse(fs.readFileSync(this.file(id), "utf8"));
    if (
      r.schemaVersion !== 1 ||
      r.id !== id ||
      !path.isAbsolute(r.localRoot ?? "") ||
      typeof r.namespace !== "string"
    )
      throw new PluginError("invalid_state", "Invalid association record.");
    return r;
  }
  list() {
    return fs
      .readdirSync(this.directory)
      .filter((p) => UUID.test(p.replace(/\.json$/, "")) && p.endsWith(".json"))
      .map((p) => this.get(p.slice(0, -5)));
  }
  async withLock(
    id,
    fn,
    { attempts = 150, interval = 20, suffix = "operation" } = {},
  ) {
    const file = `${this.file(id)}.${suffix}.lock`;
    let fd;
    for (let i = 0; i < attempts; i++) {
      try {
        fd = fs.openSync(file, "wx", 0o600);
        fs.writeFileSync(fd, String(process.pid));
        break;
      } catch (e) {
        if (e.code !== "EEXIST") throw e;
        let pid;
        try {
          pid = Number(fs.readFileSync(file, "utf8"));
        } catch (e) {
          if (e.code === "ENOENT") continue;
          throw e;
        }
        if (Number.isSafeInteger(pid) && pid > 0) {
          try {
            process.kill(pid, 0);
          } catch (e) {
            if (e.code === "ESRCH") {
              fs.rmSync(file, { force: true });
              continue;
            }
          }
        }
        await delay(interval);
      }
    }
    if (fd === undefined)
      throw new PluginError(
        "association_busy",
        "Another action owns this association; retry after it finishes.",
      );
    try {
      return await fn();
    } finally {
      fs.closeSync(fd);
      fs.rmSync(file, { force: true });
    }
  }
  async create(record) {
    return this.withLock(
      record.id,
      () => {
        if (fs.existsSync(this.file(record.id)))
          throw new PluginError(
            "association_exists",
            "Association already exists.",
          );
        const r = {
          ...record,
          schemaVersion: 1,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        atomicJson(this.file(r.id), r);
        return r;
      },
      { suffix: "state" },
    );
  }
  async update(id, change) {
    return this.withLock(
      id,
      () => {
        const next = change(this.get(id));
        next.updatedAt = new Date().toISOString();
        atomicJson(this.file(id), next);
        return next;
      },
      { suffix: "state" },
    );
  }
}
