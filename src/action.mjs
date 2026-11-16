#!/usr/bin/env node
import { parseArgs } from "node:util";
import { runAction } from "./actions.mjs";
import { emitResult, emitFailure } from "./result.mjs";

let action = process.env.HERDR_PLUGIN_ACTION_ID;
try {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      association: { type: "string" },
      artifact: { type: "string" },
      digest: { type: "string" },
      approve: { type: "boolean" },
      "confirm-delete": { type: "string" },
    },
  });
  action = action ?? positionals.shift();
  if (positionals.length) throw Error("Unexpected arguments");
  const r = await runAction(action, {
    ...values,
    confirmDelete: values["confirm-delete"],
  });
  emitResult(action, r.status, r);
} catch (e) {
  emitFailure(action ?? "unknown", e);
  process.exitCode = 1;
}
