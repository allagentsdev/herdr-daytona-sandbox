import fs from "node:fs";
import path from "node:path";
import {
  pathExclusionReason,
  readRegular,
  digest,
  contentExclusionReason,
} from "./manifest.mjs";

const [root, destination, raw] = process.argv.slice(2),
  config = JSON.parse(raw);
fs.mkdirSync(destination, { mode: 0o700 });
const files = [],
  excluded = [];
let totalBytes = 0,
  visited = 0;
function walk(relative = "") {
  const directory = path.join(root, relative);
  if (relative && fs.existsSync(path.join(directory, ".git"))) {
    excluded.push({ path: relative, reason: "nested-repository" });
    return;
  }
  for (const dirent of fs.readdirSync(directory, { withFileTypes: true })) {
    if (++visited > config.maxFiles * 10) throw Error("Export inventory limit");
    const p = relative ? `${relative}/${dirent.name}` : dirent.name;
    const reason = pathExclusionReason(p, config);
    if (reason) {
      if (excluded.length < config.maxFiles) excluded.push({ path: p, reason });
      continue;
    }
    if (dirent.isDirectory()) {
      walk(p);
      continue;
    }
    if (!dirent.isFile()) {
      if (excluded.length < config.maxFiles)
        excluded.push({ path: p, reason: "not-regular-file" });
      continue;
    }
    const entry = readRegular(root, p, config.maxFileBytes);
    const secret = contentExclusionReason(entry.bytes);
    if (secret) {
      excluded.push({ path: p, reason: secret });
      continue;
    }
    totalBytes += entry.bytes.length;
    if (files.length >= config.maxFiles || totalBytes > config.maxUploadBytes)
      throw Error("Export byte/file limit");
    const blob = String(files.length);
    fs.writeFileSync(path.join(destination, blob), entry.bytes, {
      mode: 0o600,
      flag: "wx",
    });
    files.push({
      path: p,
      blob,
      size: entry.bytes.length,
      sha256: digest(entry.bytes),
      mode: entry.mode,
    });
  }
}
walk();
fs.writeFileSync(
  path.join(destination, "manifest.json"),
  JSON.stringify({ files, excluded, totalBytes }),
  { mode: 0o600 },
);
