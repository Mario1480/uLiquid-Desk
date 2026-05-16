#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const rootDir = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const configPath = path.join(rootDir, "config", "any-budget.json");
const ANY_PATTERN = /\bany\b/g;
const SUPPRESSION_PATTERN = /@ts-(?:ignore|expect-error)/g;

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function listTypeScriptFiles(target) {
  if (!fs.existsSync(target)) return [];
  const stat = fs.statSync(target);
  if (stat.isFile()) {
    return target.endsWith(".ts") && !target.endsWith(".test.ts") ? [target] : [];
  }
  if (!stat.isDirectory()) return [];
  return fs
    .readdirSync(target, { withFileTypes: true })
    .flatMap((entry) => listTypeScriptFiles(path.join(target, entry.name)));
}

function countMatches(text, pattern) {
  return text.match(pattern)?.length ?? 0;
}

const config = readJson(configPath);
const failures = [];

for (const [name, budget] of Object.entries(config)) {
  const paths = Array.isArray(budget.paths) ? budget.paths : [];
  const files = paths.flatMap((target) => listTypeScriptFiles(path.join(rootDir, target)));
  let anyCount = 0;
  let suppressionCount = 0;

  for (const filePath of files) {
    const source = fs.readFileSync(filePath, "utf8");
    anyCount += countMatches(source, ANY_PATTERN);
    suppressionCount += countMatches(source, SUPPRESSION_PATTERN);
  }

  const maxAny = Number(budget.maxAny ?? 0);
  const maxSuppressions = Number(budget.maxSuppressions ?? 0);
  const status = anyCount <= maxAny && suppressionCount <= maxSuppressions ? "ok" : "over";
  console.log(
    `${status} ${name}: any=${anyCount}/${maxAny}, suppressions=${suppressionCount}/${maxSuppressions}, files=${files.length}`
  );

  if (anyCount > maxAny) {
    failures.push(`${name} any count ${anyCount} exceeds budget ${maxAny}`);
  }
  if (suppressionCount > maxSuppressions) {
    failures.push(`${name} suppression count ${suppressionCount} exceeds budget ${maxSuppressions}`);
  }
}

if (failures.length > 0) {
  console.error(["any budget failed:", ...failures.map((failure) => `- ${failure}`)].join("\n"));
  process.exit(1);
}
