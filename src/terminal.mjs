import path from "node:path";
import { launchCommand } from "./adapters.mjs";
import { missing, providerCall, newPtyId } from "./sandbox.mjs";
import { PluginError, errorMessage } from "./result.mjs";

export async function attachAgent(
  store,
  id,
  provider,
  { input = process.stdin, output = process.stdout, signals = process } = {},
) {
  let handle;
  await store.withLock(id, async () => {
    let r = store.get(id);
    if (!r.sandboxId || !["ready", "connected", "detached"].includes(r.phase))
      throw new PluginError(
        "setup_incomplete",
        "This association has no prepared agent workspace. Inspect status; reconnect never reuploads.",
      );
    const box = await provider.get(r.sandboxId);
    if (!box)
      throw new PluginError(
        "provider_missing",
        "The saved sandbox no longer exists.",
      );
    await provider.resume(box);
    const onData = (data) => {
      output.write(Buffer.from(data));
    };
    const launch = async () => {
      try {
        await store.update(id, (v) => ({ ...v, ptyPhase: "launching" }));
        await providerCall(() => handle.sendInput(launchCommand(r.config)));
        await store.update(id, (v) => ({ ...v, ptyPhase: "launched" }));
      } catch (e) {
        await handle.disconnect();
        throw e;
      }
    };
    let active = false;
    if (r.ptyId) {
      try {
        active = (
          await providerCall(() => box.process.getPtySessionInfo(r.ptyId))
        ).active;
      } catch (e) {
        if (e.code !== "provider_missing" && !missing(e)) throw e;
      }
    }
    if (active) {
      handle = await providerCall(() =>
        box.process.connectPty(r.ptyId, { onData }),
      );
      if (r.ptyPhase === "creating") await launch();
      else if (r.ptyPhase !== "launched")
        output.write(
          "\r\nPrevious launch outcome is uncertain. Attached without resending the agent command.\r\n",
        );
    } else {
      const ptyId = newPtyId();
      r = await store.update(id, (v) => ({
        ...v,
        ptyId,
        ptyPhase: "creating",
      }));
      handle = await providerCall(() =>
        box.process.createPty({
          id: ptyId,
          cwd: path.posix.join(r.config.remoteRoot, r.relativeCwd),
          envs: provider.environment(),
          cols: output.columns ?? 80,
          rows: output.rows ?? 24,
          onData,
        }),
      );
      await launch();
    }
    try {
      await store.update(id, (v) => ({
        ...v,
        phase: "connected",
        remotePaneId: process.env.HERDR_PANE_ID ?? v.remotePaneId,
        lastError: null,
      }));
    } catch (e) {
      await handle.disconnect();
      throw e;
    }
  });
  let detach, fail;
  const detached = new Promise((resolve, reject) => {
    detach = resolve;
    fail = reject;
  });
  let writes = Promise.resolve();
  const send = (chunk) => {
    writes = writes
      .then(() => providerCall(() => handle.sendInput(chunk)))
      .catch(fail);
  };
  const resize = () => {
    providerCall(() =>
      handle.resize(output.columns ?? 80, output.rows ?? 24),
    ).catch(fail);
  };
  const onEnd = () => detach({ detached: true });
  const onError = () =>
    fail(
      new PluginError(
        "terminal_io",
        "Local terminal transport failed. The remote sandbox is retained.",
      ),
    );
  const wasRaw = Boolean(input.isRaw);
  try {
    input.on("data", send);
    input.on("end", onEnd);
    input.on("error", onError);
    output.on("resize", resize);
    for (const signal of ["SIGHUP", "SIGTERM", "SIGINT"])
      signals.on(signal, onEnd);
    if (input.isTTY) input.setRawMode(true);
    input.resume();
    resize();
    const result = await Promise.race([
      providerCall(() => handle.wait()),
      detached,
    ]);
    if (result.detached) return result;
    if (result.error || !Number.isInteger(result.exitCode))
      throw new PluginError(
        "pty_transport",
        "Terminal transport ended without a confirmed clean agent exit. The sandbox is retained; reconnect to inspect the session.",
      );
    if (result.exitCode !== 0) {
      const error = new PluginError(
        "agent_exit",
        `Agent exited with status ${result.exitCode}. Sandbox files are retained.`,
      );
      error.exitCode =
        result.exitCode > 0 && result.exitCode <= 255 ? result.exitCode : 1;
      throw error;
    }
    return result;
  } catch (e) {
    await store.update(id, (v) => ({ ...v, lastError: errorMessage(e) }));
    throw e;
  } finally {
    input.off("data", send);
    input.off("end", onEnd);
    input.off("error", onError);
    output.off("resize", resize);
    for (const signal of ["SIGHUP", "SIGTERM", "SIGINT"])
      signals.off(signal, onEnd);
    if (input.isTTY) input.setRawMode(wasRaw);
    input.pause();
    output.write(
      "\x1b[?1000l\x1b[?1002l\x1b[?1003l\x1b[?1006l\x1b[?2004l\x1b[?1049l\x1b[?25h\x1b[0m",
    );
    await handle.disconnect();
    await store.update(id, (v) => ({
      ...v,
      phase: v.phase === "connected" ? "detached" : v.phase,
    }));
  }
}
