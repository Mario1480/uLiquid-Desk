#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const rootDir = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");

async function loadRootEnv() {
  const envPath = path.join(rootDir, ".env");
  if (!fs.existsSync(envPath)) return;
  try {
    const dotenv = await import("dotenv");
    const parsed = dotenv.parse(fs.readFileSync(envPath));
    for (const [key, value] of Object.entries(parsed)) {
      if (key === "NODE_ENV") continue;
      if (process.env[key] === undefined) {
        process.env[key] = value;
      }
    }
  } catch {
    console.warn("[workspace-order] dotenv not available; continuing without loading root .env");
  }
}

function usage() {
  console.error(
    [
      "Usage: node scripts/run_workspace_ordered.mjs <script> [--skip <package>] [--prisma-generate] [--dry-run]",
      "",
      "Runs an npm workspace script in dependency order for the configured root workspaces."
    ].join("\n")
  );
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function expandWorkspacePattern(pattern) {
  const normalized = pattern.replace(/\\/g, "/");
  if (!normalized.endsWith("/*")) {
    const abs = path.join(rootDir, normalized);
    return fs.existsSync(path.join(abs, "package.json")) ? [abs] : [];
  }

  const baseDir = path.join(rootDir, normalized.slice(0, -2));
  if (!fs.existsSync(baseDir)) return [];
  return fs
    .readdirSync(baseDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(baseDir, entry.name))
    .filter((workspaceDir) => fs.existsSync(path.join(workspaceDir, "package.json")));
}

function collectInternalDependencyNames(pkg) {
  return Object.keys({
    ...(pkg.dependencies ?? {}),
    ...(pkg.devDependencies ?? {}),
    ...(pkg.peerDependencies ?? {}),
    ...(pkg.optionalDependencies ?? {})
  });
}

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: rootDir,
    stdio: "inherit",
    shell: process.platform === "win32"
  });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

const args = process.argv.slice(2);
let scriptName = "";
let prismaGenerate = false;
let dryRun = false;
const skipped = new Set();

for (let index = 0; index < args.length; index += 1) {
  const arg = args[index];
  if (arg === "--help" || arg === "-h") {
    usage();
    process.exit(0);
  }
  if (arg === "--prisma-generate") {
    prismaGenerate = true;
    continue;
  }
  if (arg === "--dry-run") {
    dryRun = true;
    continue;
  }
  if (arg === "--skip") {
    const value = args[index + 1];
    if (!value) {
      console.error("[workspace-order] --skip requires a package name or workspace path.");
      process.exit(1);
    }
    for (const item of value.split(",")) {
      if (item.trim()) skipped.add(item.trim());
    }
    index += 1;
    continue;
  }
  if (arg.startsWith("--skip=")) {
    for (const item of arg.slice("--skip=".length).split(",")) {
      if (item.trim()) skipped.add(item.trim());
    }
    continue;
  }
  if (!scriptName) {
    scriptName = arg;
    continue;
  }
  console.error(`[workspace-order] Unexpected argument: ${arg}`);
  usage();
  process.exit(1);
}

if (!scriptName) {
  usage();
  process.exit(1);
}

await loadRootEnv();

const rootPackage = readJson(path.join(rootDir, "package.json"));
const workspacePatterns = rootPackage.workspaces ?? [];
const workspaces = workspacePatterns
  .flatMap(expandWorkspacePattern)
  .map((workspaceDir) => {
    const pkg = readJson(path.join(workspaceDir, "package.json"));
    return {
      dir: path.relative(rootDir, workspaceDir),
      name: pkg.name,
      pkg
    };
  })
  .filter((workspace) => workspace.name)
  .sort((left, right) => {
    const leftPriority = left.dir.startsWith("packages/") ? 0 : left.dir.startsWith("apps/") ? 1 : 2;
    const rightPriority = right.dir.startsWith("packages/") ? 0 : right.dir.startsWith("apps/") ? 1 : 2;
    return leftPriority - rightPriority || left.dir.localeCompare(right.dir);
  });

const allByName = new Map(workspaces.map((workspace) => [workspace.name, workspace]));
const selectedByName = new Map(
  workspaces
    .filter((workspace) => workspace.pkg.scripts?.[scriptName])
    .filter((workspace) => !skipped.has(workspace.name) && !skipped.has(workspace.dir))
    .map((workspace) => [workspace.name, workspace])
);

const visiting = new Set();
const visited = new Set();
const ordered = [];

function visit(workspace) {
  if (visited.has(workspace.name)) return;
  if (visiting.has(workspace.name)) {
    console.error(`[workspace-order] Circular internal workspace dependency at ${workspace.name}.`);
    process.exit(1);
  }
  visiting.add(workspace.name);
  for (const dependencyName of collectInternalDependencyNames(workspace.pkg)) {
    const dependency = selectedByName.get(dependencyName);
    if (dependency) visit(dependency);
    else if (allByName.has(dependencyName) && !selectedByName.has(dependencyName)) {
      const skippedDependency = allByName.get(dependencyName);
      if (!skipped.has(skippedDependency.name) && !skipped.has(skippedDependency.dir)) {
        console.error(
          `[workspace-order] ${workspace.name} depends on ${dependencyName}, but ${dependencyName} has no ${scriptName} script.`
        );
        process.exit(1);
      }
    }
  }
  visiting.delete(workspace.name);
  visited.add(workspace.name);
  ordered.push(workspace);
}

for (const workspace of selectedByName.values()) {
  visit(workspace);
}

if (ordered.length === 0) {
  console.log(`[workspace-order] No workspaces expose script "${scriptName}".`);
  process.exit(0);
}

console.log(`[workspace-order] ${scriptName} order: ${ordered.map((workspace) => workspace.name).join(" -> ")}`);

if (dryRun) {
  process.exit(0);
}

if (prismaGenerate) {
  console.log("[workspace-order] running prisma generate");
  run("npx", ["prisma", "generate"]);
}

for (const workspace of ordered) {
  console.log(`[workspace-order] npm --workspace ${workspace.dir} run ${scriptName}`);
  run("npm", ["--workspace", workspace.dir, "run", scriptName]);
}
