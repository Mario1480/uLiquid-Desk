import { existsSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { readdirSync } from "node:fs";

const packageJsonPath = path.join(process.cwd(), "package.json");
const packageJson = existsSync(packageJsonPath)
  ? JSON.parse(readFileSync(packageJsonPath, "utf8"))
  : null;

if (packageJson?.name !== "web") {
  throw new Error("clean_next_artifacts must be run from the apps/web workspace");
}

const nextDir = path.join(process.cwd(), ".next");
const cleanBuild = process.argv.includes("--build") || process.argv.includes("--all");

function isNumberedDuplicateArtifact(name) {
  return /\s+\d+(?:\.[^.]+)*$/.test(name);
}

function removeNumberedDuplicateArtifactsIn(directory) {
  if (!existsSync(directory)) return;
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isFile() && isNumberedDuplicateArtifact(entry.name)) {
      rmSync(fullPath, {
        force: true
      });
    }
  }
}

rmSync(path.join(nextDir, "types"), {
  recursive: true,
  force: true
});

if (cleanBuild) {
  rmSync(path.join(nextDir, "lock"), {
    force: true
  });
  for (const directory of [
    nextDir,
    path.join(nextDir, "server"),
    path.join(nextDir, "standalone"),
    path.join(nextDir, "static")
  ]) {
    removeNumberedDuplicateArtifactsIn(directory);
  }
}
