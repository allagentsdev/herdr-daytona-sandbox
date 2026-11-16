import readline from "node:readline/promises";
import { safeText, PluginError } from "./result.mjs";
export function show(text, output = process.stdout) {
  output.write(`${safeText(text)}\n`);
}
export async function question(
  prompt,
  { input = process.stdin, output = process.stdout } = {},
) {
  if (!input.isTTY || !output.isTTY)
    throw new PluginError(
      "interactive_required",
      "Interactive confirmation is required. Nothing was approved.",
    );
  const rl = readline.createInterface({ input, output });
  try {
    return await rl.question(safeText(prompt), {
      signal: AbortSignal.timeout(5 * 60 * 1000),
    });
  } finally {
    rl.close();
  }
}
export async function review(text) {
  if (!process.stdin.isTTY || !process.stdout.isTTY)
    throw new PluginError(
      "interactive_required",
      "Review artifact saved. Use its exact artifact ID and digest in a separate approval invocation.",
    );
  const lines = safeText(text).split("\n");
  const height = Math.max(5, (process.stdout.rows ?? 24) - 5);
  for (let i = 0; i < lines.length; i += height) {
    show(lines.slice(i, i + height).join("\n"));
    if (
      i + height < lines.length &&
      (await question("Enter: next page; q: cancel > ")).trim() !== ""
    )
      return false;
  }
  return (
    (await question(
      "Apply these exact reviewed bytes? Type APPLY (anything else cancels) > ",
    )) === "APPLY"
  );
}
export async function dismiss() {
  if (process.stdin.isTTY && process.stdout.isTTY)
    await question("\nPress Enter to close. ");
}
