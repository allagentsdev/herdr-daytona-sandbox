import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { managementAuth, agentEnvironment, safeRelative } from "./config.mjs";
import { getAdapter, installCommand } from "./adapters.mjs";
import {
  readSnapshot,
  saveSnapshot,
  pathExclusionReason,
  digest,
  contentExclusionReason,
} from "./manifest.mjs";
import { shellQuote } from "./process.mjs";
import { PluginError, errorMessage } from "./result.mjs";
import { PLUGIN_ID } from "./constants.mjs";

export function missing(error) {
  return error?.statusCode === 404 || error?.response?.status === 404;
}
export async function providerCall(fn) {
  try {
    return await fn();
  } catch (error) {
    if (error instanceof PluginError) throw error;
    const status = error?.statusCode ?? error?.response?.status;
    throw new PluginError(
      status === 401 || status === 403
        ? "provider_auth"
        : status === 404
          ? "provider_missing"
          : "provider_request",
      status === 401 || status === 403
        ? "Daytona authentication was rejected. Check the local key/JWT and organization."
        : `Daytona request failed${Number.isInteger(status) ? ` (HTTP ${status})` : ""}. The request may have reached the provider; inspect retained state before retrying.`,
    );
  }
}
export class DaytonaProvider {
  constructor(client, config) {
    this.client = client;
    this.config = config;
  }
  static async connect(config, store, env = process.env) {
    const auth = managementAuth(config, env);
    const runtime = path.join(store.directory, "sdk-runtime");
    fs.mkdirSync(runtime, { recursive: true, mode: 0o700 });
    // Keep the stable SDK's cwd dotenv reader away from repository-controlled files.
    process.chdir(runtime);
    const { Daytona } = await import("@daytona/sdk");
    return new DaytonaProvider(new Daytona(auth), config);
  }
  async create(record) {
    const c = this.config;
    return providerCall(() =>
      this.client.create(
        {
          name: `herdr-${record.id}`,
          user: "root",
          language: "typescript",
          ...(c.snapshot ? { snapshot: c.snapshot } : { image: c.image }),
          target: c.region,
          labels: {
            "herdr-operation": record.id,
            "herdr-plugin": PLUGIN_ID,
          },
          ephemeral: false,
          autoStopInterval: c.autoStopInterval,
          autoDeleteInterval: -1,
          ttlMinutes: 0,
          public: false,
        },
        { timeout: c.createTimeoutSeconds },
      ),
    );
  }
  async reconcile(id) {
    return providerCall(async () => {
      const matches = [];
      for await (const s of this.client.list({
        labels: { "herdr-operation": id, "herdr-plugin": PLUGIN_ID },
      })) {
        if (s.labels?.["herdr-operation"] === id) matches.push(s);
        if (matches.length > 1)
          throw new PluginError(
            "creation_ambiguous",
            "Multiple sandboxes match this operation. Resolve in Daytona before continuing.",
          );
      }
      return matches[0] ?? null;
    });
  }
  async get(id) {
    return providerCall(async () => {
      try {
        return await this.client.get(id);
      } catch (e) {
        if (missing(e)) return null;
        throw e;
      }
    });
  }
  async exec(sandbox, command, cwd = this.config.remoteRoot, env = {}) {
    const r = await providerCall(() =>
      sandbox.process.executeCommand(
        command,
        cwd,
        env,
        this.config.execTimeoutSeconds,
      ),
    );
    if (r.exitCode !== 0)
      throw new PluginError(
        "remote_command_failed",
        "Remote setup/export failed. Check the selected image and recorded lifecycle phase; the sandbox is retained.",
      );
    return r.result;
  }
  async resume(sandbox) {
    if (["stopped", "archived", "paused"].includes(sandbox.state))
      await providerCall(() => sandbox.start(this.config.createTimeoutSeconds));
    else if (sandbox.state !== "started")
      throw new PluginError(
        "sandbox_not_ready",
        `Sandbox state is ${sandbox.state ?? "unknown"}; inspect status before retrying.`,
      );
    return sandbox;
  }
  async prepare(sandbox, record, snapshot, onPhase = () => {}) {
    const c = this.config,
      a = getAdapter(c.agent, c);
    await onPhase("checking", "Checking Linux tools");
    await this.exec(
      sandbox,
      'set -eu; test "$(uname -s)" = Linux; command -v bash; command -v git; command -v node; command -v npm; test "$(node -p \'Number(process.versions.node.split(".")[0])>=22\')" = true',
      "/",
    );
    if (record.phase !== "created")
      throw new PluginError(
        "setup_incomplete",
        "An interrupted setup is retained. Inspect the sandbox before starting a fresh association; reconnect never reuploads.",
      );
    await this.exec(sandbox, `mkdir -p ${shellQuote(c.remoteRoot)}`, "/");
    await onPhase("uploading", "Uploading staged files");
    for (const f of snapshot.files) {
      const remote = path.posix.join(c.remoteRoot, f.path);
      await this.exec(
        sandbox,
        `mkdir -p ${shellQuote(path.posix.dirname(remote))}`,
        "/",
      );
      await providerCall(() =>
        sandbox.fs.uploadFile(
          path.join(snapshot.directory, "files", f.path),
          remote,
          c.execTimeoutSeconds,
        ),
      );
      await providerCall(() =>
        sandbox.fs.setFilePermissions(remote, {
          mode: f.mode === "100755" ? "755" : "644",
        }),
      );
    }
    await onPhase("preparing", `Installing ${a.kind}`);
    await this.exec(sandbox, installCommand(a), "/");
    const installedVersion = (
      await this.exec(
        sandbox,
        a.versionCommand ?? `${shellQuote(a.binary)} --version`,
        "/",
      )
    ).trim();
    const expectedVersion = a.version.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (
      !new RegExp(`(?:^|\\D)${expectedVersion}(?:$|\\D)`).test(installedVersion)
    )
      throw new PluginError(
        "agent_version",
        "Installed agent version differs from its pinned adapter.",
      );
    await this.exec(
      sandbox,
      `set -eu; git init -q; git -c core.hooksPath=/dev/null add -A; git -c core.hooksPath=/dev/null -c user.name=Herdr -c user.email=herdr@localhost commit -q --allow-empty -m 'Uploaded worktree baseline'`,
      c.remoteRoot,
    );
    if (c.installDependencies) await this.exec(sandbox, "npm ci", c.remoteRoot);
    await this.exec(
      sandbox,
      `mkdir -p -- ${shellQuote(path.posix.join(c.remoteRoot, record.relativeCwd))}`,
      c.remoteRoot,
    );
    return installedVersion;
  }
  environment(env = process.env) {
    return agentEnvironment(this.config, env);
  }
  async delete(sandbox) {
    await providerCall(() =>
      sandbox.delete(this.config.createTimeoutSeconds, true),
    );
    const after = await this.get(sandbox.id);
    if (after && after.state !== "destroyed")
      throw new PluginError(
        "deletion_uncertain",
        "Deletion is not confirmed. Recovery metadata is retained.",
      );
  }
  async download(sandbox, remote, maxBytes) {
    return providerCall(async () => {
      const controller = new AbortController();
      const stream = await sandbox.fs.downloadFileStream(remote, {
        timeout: this.config.execTimeoutSeconds,
        signal: controller.signal,
      });
      const chunks = [];
      let size = 0;
      try {
        for await (const chunk of stream) {
          size += chunk.length;
          if (size > maxBytes) {
            controller.abort();
            throw new PluginError(
              "download_limit",
              "Remote download exceeded its declared byte limit.",
            );
          }
          chunks.push(Buffer.from(chunk));
        }
      } finally {
        stream.destroy();
      }
      return Buffer.concat(chunks);
    });
  }
  async exportSnapshot(record, directory) {
    const c = this.config,
      sandbox = await this.get(record.sandboxId);
    if (!sandbox || sandbox.state !== "started")
      throw new PluginError(
        "sandbox_not_running",
        "Patch export requires a running sandbox. Reconnect first to resume; status never starts it.",
      );
    const tools = `/tmp/herdr-tools-${randomUUID()}`,
      remote = `/tmp/herdr-export-${randomUUID()}`;
    try {
      await providerCall(() => sandbox.fs.createFolder(tools, "700"));
      for (const name of [
        "remote-files.mjs",
        "manifest.mjs",
        "process.mjs",
        "config.mjs",
        "credentials.mjs",
        "constants.mjs",
        "result.mjs",
        "state.mjs",
      ]) {
        await providerCall(() =>
          sandbox.fs.uploadFile(
            fs.readFileSync(new URL(`./${name}`, import.meta.url)),
            `${tools}/${name}`,
            c.execTimeoutSeconds,
          ),
        );
      }
      const policy = {
        excludedPaths: c.excludedPaths,
        maxFiles: c.maxFiles,
        maxFileBytes: c.maxFileBytes,
        maxUploadBytes: c.maxUploadBytes,
      };
      await this.exec(
        sandbox,
        `node ${shellQuote(`${tools}/remote-files.mjs`)} ${shellQuote(c.remoteRoot)} ${shellQuote(remote)} ${shellQuote(JSON.stringify(policy))}`,
        "/",
      );
      const metadata = JSON.parse(
        (
          await this.download(
            sandbox,
            `${remote}/manifest.json`,
            c.maxFiles * 8192 + 1024,
          )
        ).toString("utf8"),
      );
      if (
        !Array.isArray(metadata.files) ||
        metadata.files.length > c.maxFiles ||
        !Array.isArray(metadata.excluded) ||
        metadata.excluded.length > c.maxFiles * 10 ||
        metadata.excluded.some(
          (e) => !e || !safeRelative(e.path) || typeof e.reason !== "string",
        )
      )
        throw new PluginError(
          "remote_export",
          "Invalid remote file inventory.",
        );
      let total = 0;
      const names = new Set();
      for (const f of metadata.files) {
        if (
          pathExclusionReason(f.path, c) ||
          !["100644", "100755"].includes(f.mode) ||
          !Number.isSafeInteger(f.size) ||
          f.size < 0 ||
          f.size > c.maxFileBytes ||
          !/^[0-9]+$/.test(f.blob) ||
          !/^[0-9a-f]{64}$/.test(f.sha256) ||
          names.has(f.path)
        )
          throw new PluginError(
            "remote_export",
            "Unsafe remote inventory entry.",
          );
        names.add(f.path);
        total += f.size;
        if (total > c.maxUploadBytes)
          throw new PluginError(
            "download_limit",
            "Remote export exceeds maxUploadBytes.",
          );
      }
      const entries = [];
      for (const f of metadata.files) {
        const bytes = await this.download(
          sandbox,
          `${remote}/${f.blob}`,
          f.size,
        );
        if (bytes.length !== f.size || digest(bytes) !== f.sha256)
          throw new PluginError(
            "remote_export_changed",
            "Remote export changed during download.",
          );
        if (contentExclusionReason(bytes))
          throw new PluginError(
            "remote_export",
            "A returned file contains a detected secret.",
          );
        entries.push({ path: f.path, mode: f.mode, bytes });
      }
      return saveSnapshot(
        directory,
        entries,
        metadata.excluded.map(({ path, reason }) => ({ path, reason })),
      );
    } finally {
      await this.exec(
        sandbox,
        `rm -rf -- ${shellQuote(tools)} ${shellQuote(remote)}`,
        "/",
      ).catch(() => {});
    }
  }
}
export async function provision(store, id, provider, onPhase = () => {}) {
  return store.withLock(id, async () => {
    let r = store.get(id),
      sandbox;
    try {
      if (r.sandboxId) {
        if (r.phase === "ready") return r;
        throw new PluginError(
          "setup_incomplete",
          "Sandbox setup was interrupted. Its ID is retained; reconnect will not overwrite its workspace.",
        );
      }
      if (r.creationAttempted) {
        sandbox = await provider.reconcile(id);
        if (!sandbox) {
          await store.update(id, (v) => ({
            ...v,
            phase: "creation-uncertain",
          }));
          throw new PluginError(
            "creation_uncertain",
            "Creation outcome is uncertain. No new sandbox was allocated. Retry reconciliation later or inspect the operation label in Daytona.",
          );
        }
      } else {
        readSnapshot(r.baseline);
        await store.update(id, (v) => ({
          ...v,
          phase: "creating",
          creationAttempted: true,
        }));
        onPhase("Creating persistent sandbox");
        sandbox = await provider.create(r);
      }
      r = await store.update(id, (v) => ({
        ...v,
        sandboxId: sandbox.id,
        phase: "created",
      }));
      const snapshot = readSnapshot(r.baseline);
      const installedVersion = await provider.prepare(
        sandbox,
        r,
        snapshot,
        async (phase, message) => {
          await store.update(id, (v) => ({ ...v, phase }));
          onPhase(message);
        },
      );
      return await store.update(id, (v) => ({
        ...v,
        phase: "ready",
        installedVersion,
        ptyId: null,
        checkpoint: v.baseline,
        checkpointDigest: v.baselineDigest,
        lastError: null,
      }));
    } catch (e) {
      await store.update(id, (v) => ({
        ...v,
        phase:
          v.phase === "creation-uncertain"
            ? "creation-uncertain"
            : v.sandboxId
              ? "failed"
              : "creation-uncertain",
        lastError: errorMessage(e),
      }));
      throw e;
    }
  });
}
export const newPtyId = () => `herdr-${randomUUID()}`;
