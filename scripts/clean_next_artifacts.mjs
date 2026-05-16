import { existsSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";

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

function removeArtifact(fullPath, recursive) {
  try {
    rmSync(fullPath, {
      recursive,
      force: true,
      maxRetries: 3,
      retryDelay: 100
    });
  } catch (error) {
    if (!recursive || (error?.code !== "ENOTEMPTY" && error?.code !== "EBUSY")) {
      throw error;
    }
    const result = spawnSync("rm", ["-rf", fullPath], {
      stdio: "ignore"
    });
    if (result.status !== 0) {
      throw error;
    }
  }
}

function removeNumberedDuplicateArtifactsIn(directory) {
  if (!existsSync(directory)) return;
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name);
    if ((entry.isFile() || entry.isDirectory()) && isNumberedDuplicateArtifact(entry.name)) {
      removeArtifact(fullPath, entry.isDirectory());
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
