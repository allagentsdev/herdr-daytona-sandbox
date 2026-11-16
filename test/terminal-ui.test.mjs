import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { reviewText } from "../src/patch.mjs";
import { review, question } from "../src/terminal-ui.mjs";
import { temporary } from "./helpers.mjs";
test("review displays controls and invalid UTF-8 as visible escapes while saved bytes remain exact", (t) => {
  const patchPath = path.join(temporary(t), "changes.patch");
  const bytes = Buffer.from([65, 27, 91, 50, 74, 13, 10, 255]);
  fs.writeFileSync(patchPath, bytes);
  const text = reviewText({
    patchPath,
    destination: "/tmp/dest",
    association: "a",
    artifact: "b",
    digest: "sha",
    changedPaths: ["name\x1b[2J"],
  });
  assert.ok(text.includes("A\\x1b[2J\\x0d\n\\xff"));
  assert.ok(!text.includes("\x1b"));
  assert.deepEqual(fs.readFileSync(patchPath), bytes);
});
test("missing terminal input is never approval", async () => {
  await assert.rejects(
    question("Approve?", { input: { isTTY: false }, output: { isTTY: false } }),
    { code: "interactive_required" },
  );
  await assert.rejects(review("patch"), { code: "interactive_required" });
});
