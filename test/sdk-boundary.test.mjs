import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { runSync } from "../src/process.mjs";
import { temporary, write } from "./helpers.mjs";
test("real pinned SDK constructor runs in plugin-owned cwd with explicit endpoint, region and credentials", (t) => {
  const hostile = temporary(t),
    state = temporary(t);
  write(
    hostile,
    ".env",
    "DAYTONA_API_KEY=repo-controlled\nDAYTONA_API_URL=https://wrong.invalid/api\nDAYTONA_TARGET=wrong\n",
  );
  write(hostile, ".env.local", "DAYTONA_JWT_TOKEN=repo-jwt\n");
  const sandbox = new URL("../src/sandbox.mjs", import.meta.url).href;
  const config = new URL("../src/config.mjs", import.meta.url).href;
  const store = new URL("../src/state.mjs", import.meta.url).href;
  const script = `const {DaytonaProvider}=await import(${JSON.stringify(sandbox)});const {validateConfig}=await import(${JSON.stringify(config)});const {Store}=await import(${JSON.stringify(store)});const p=await DaytonaProvider.connect(validateConfig({}),new Store(${JSON.stringify(state)}),{DAYTONA_API_KEY:'fixture-only'});console.log(JSON.stringify({cwd:process.cwd(),apiUrl:p.client.apiUrl,target:p.client.target}));`;
  const result = runSync(
    process.execPath,
    ["--input-type=module", "-e", script],
    { cwd: hostile },
  );
  assert.deepEqual(JSON.parse(result.stdout), {
    cwd: path.join(state, "sdk-runtime"),
    apiUrl: "https://app.daytona.io/api",
    target: "eu",
  });
});
