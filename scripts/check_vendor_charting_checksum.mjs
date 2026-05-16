#!/usr/bin/env node
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const repoRoot = process.cwd();
const docPath = "docs/vendor-charting-library.md";
const assetRoots = [
  "apps/web/public/static/charting_library",
  "apps/web/public/static/datafeeds"
];

function toPosix(value) {
  return value.split(path.sep).join("/");
}

function sha256Hex(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

const doc = readFileSync(path.join(repoRoot, docPath), "utf8");
const expected = doc.match(/Static bundle checksum:\s*`([a-f0-9]{64})`/i)?.[1]?.toLowerCase();

if (!expected) {
  console.error(`[vendor-charting] missing Static bundle checksum in ${docPath}`);
  process.exit(1);
}

for (const root of assetRoots) {
  if (!existsSync(path.join(repoRoot, root))) {
    throw new Error(`missing vendor asset directory: ${root}`);
  }
}

const files = execFileSync("git", ["ls-files", "-z", "--", ...assetRoots], {
  cwd: repoRoot
})
  .toString("utf8")
  .split("\0")
  .filter(Boolean)
  .map(toPosix)
  .sort();

if (files.length === 0) {
  console.error("[vendor-charting] no vendor charting assets found");
  process.exit(1);
}

const manifest = files.map((file) => {
  const absoluteFile = path.join(repoRoot, file);
  const stats = statSync(absoluteFile);
  if (!stats.isFile()) {
    throw new Error(`not a regular file: ${file}`);
  }
  return `${sha256Hex(readFileSync(absoluteFile))}  ${file}\n`;
}).join("");

const actual = sha256Hex(Buffer.from(manifest, "utf8"));

if (actual !== expected) {
  console.error("[vendor-charting] checksum mismatch");
  console.error(`expected: ${expected}`);
  console.error(`actual:   ${actual}`);
  console.error(`update ${docPath} only after confirming the vendored TradingView bundle source/version`);
  process.exit(1);
}

console.log(`[vendor-charting] ok ${actual} (${files.length} files)`);
