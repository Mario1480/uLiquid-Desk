#!/usr/bin/env node

const MIN_NODE = [20, 9, 0];
const MAX_NODE_MAJOR = 21;

function parseVersion(value) {
  return String(value || "")
    .split(".")
    .map((part) => Number.parseInt(part, 10))
    .map((part) => (Number.isFinite(part) ? part : 0));
}

function compareVersion(left, right) {
  const maxLength = Math.max(left.length, right.length);
  for (let index = 0; index < maxLength; index += 1) {
    const leftPart = left[index] ?? 0;
    const rightPart = right[index] ?? 0;
    if (leftPart > rightPart) return 1;
    if (leftPart < rightPart) return -1;
  }
  return 0;
}

function fail(message) {
  console.error(`\n${message}\n`);
  process.exit(1);
}

const userAgent = process.env.npm_config_user_agent || "";
const npmExecPath = process.env.npm_execpath || "";
if (
  userAgent.startsWith("pnpm/")
  || userAgent.startsWith("yarn/")
  || npmExecPath.includes("pnpm")
  || npmExecPath.includes("yarn")
) {
  fail("This repository is standardized on npm workspaces. Please use npm instead of pnpm/yarn.");
}

const nodeVersion = parseVersion(process.versions.node);
if (compareVersion(nodeVersion, MIN_NODE) < 0 || nodeVersion[0] >= MAX_NODE_MAJOR) {
  fail(
    `Node.js ${process.versions.node} is not supported. Use Node.js >=20.9.0 <21 for this repository.`
  );
}
