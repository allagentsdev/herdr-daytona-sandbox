#!/usr/bin/env node
import { pathToFileURL } from "node:url";
import { loadConfig, managementAuth } from "./config.mjs";
import { promptApiKey, saveApiKey } from "./credentials.mjs";
import { Store } from "./state.mjs";
import { DaytonaProvider, providerCall } from "./sandbox.mjs";
import { emitResult } from "./result.mjs";
import { runPane } from "./pane-runtime.mjs";
import { show, dismiss } from "./terminal-ui.mjs";

async function verify(config, store, env) {
  await providerCall(async () => {
    const provider = await DaytonaProvider.connect(config, store, env);
    const sandboxes = provider.client.list({ limit: 1 });
    try {
      await sandboxes.next();
    } finally {
      await sandboxes.return?.();
    }
  });
}
export async function connectDaytona({
  env = process.env,
  input = process.stdin,
  output = process.stdout,
} = {}) {
  const config = loadConfig(env),
    store = new Store(env.HERDR_PLUGIN_STATE_DIR);
  try {
    managementAuth(config, env);
    await verify(config, store, env);
    show(
      "Daytona authentication verified with a read-only sandbox list request. No sandbox was created.",
      output,
    );
    return "verified";
  } catch (error) {
    if (!["missing_auth", "provider_auth"].includes(error.code)) throw error;
    show(
      error.code === "missing_auth"
        ? "Daytona authentication is not configured."
        : "Daytona authentication was rejected.",
      output,
    );
  }
  show(
    `Create an organization API key at https://app.daytona.io/dashboard/keys (Create Key, choose expiration and permissions, then copy it).\nThe key will be checked against the configured endpoint ${config.apiUrl} before saving locally.\nFor a custom Daytona deployment, use its own dashboard to create the key.`,
    output,
  );
  const key = await promptApiKey({ input, output });
  if (key === null) {
    show("Cancelled. No credentials were saved.", output);
    return "cancelled";
  }
  await verify(config, store, { ...env, [config.apiKeyEnv]: key });
  saveApiKey(config, key, env);
  show(
    "Daytona authentication verified. The API key was saved in the private plugin configuration directory. No sandbox was created.",
    output,
  );
  if (
    env[config.apiKeyEnv] ||
    (env[config.jwtTokenEnv] && env[config.organizationIdEnv])
  )
    show(
      "Configured environment authentication retains precedence over the saved key. Update or unset it to use the saved key.",
      output,
    );
  return "connected";
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  await runPane("connect-daytona", async () => {
    emitResult("connect-daytona", await connectDaytona());
    await dismiss();
  });
}
