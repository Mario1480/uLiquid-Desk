import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { comparePublicProbes } from "./comparison.mjs";

const execFileAsync = promisify(execFile);
const directory = path.dirname(fileURLToPath(import.meta.url));
const versions = JSON.parse(await readFile(path.join(directory, "versions.json"), "utf8"));

const FORBIDDEN_CREDENTIALS = ["BITGET_API_KEY", "BITGET_API_SECRET", "BITGET_API_PASSPHRASE"];

function assertCredentialFreeEnvironment() {
  const present = FORBIDDEN_CREDENTIALS.filter((key) => String(process.env[key] ?? "").trim());
  if (present.length > 0) throw new Error(`poc_credentials_forbidden:${present.join(",")}`);
}

function isolatedEnvironment(home) {
  return {
    HOME: home,
    LANG: process.env.LANG ?? "C.UTF-8",
    LC_ALL: process.env.LC_ALL ?? "C.UTF-8",
    PATH: process.env.PATH ?? "/usr/bin:/bin:/usr/sbin:/sbin",
    TMPDIR: process.env.TMPDIR ?? os.tmpdir(),
    ULIQ_HB_POC_ENABLED: "true"
  };
}

function parseArgs() {
  const values = { symbol: "BTCUSDT", samples: 3, depth: 25, timeoutMs: 10_000, output: null };
  for (let index = 2; index < process.argv.length; index += 1) {
    const key = process.argv[index];
    const value = process.argv[index + 1];
    if (key === "--symbol") values.symbol = value, index += 1;
    else if (key === "--samples") values.samples = Number(value), index += 1;
    else if (key === "--depth") values.depth = Number(value), index += 1;
    else if (key === "--timeout-ms") values.timeoutMs = Number(value), index += 1;
    else if (key === "--output") values.output = value, index += 1;
  }
  return values;
}

if (process.env.ULIQ_HB_POC_ENABLED !== "true") {
  throw new Error("POC is disabled. Set ULIQ_HB_POC_ENABLED=true for bounded public reads.");
}

const options = parseArgs();
assertCredentialFreeEnvironment();
const temporaryHome = await mkdtemp(path.join(os.tmpdir(), "uliq-hb-public-poc-"));
const env = isolatedEnvironment(temporaryHome);
const processStartedAt = Date.now();
const processDeadlineMs = 300_000;
try {
  const nativeResult = await execFileAsync(process.execPath, [
    path.join(directory, "native-public-probe.mjs"),
    JSON.stringify(options)
  ], { env, timeout: processDeadlineMs, maxBuffer: 2_000_000 });
  const nativeProbe = JSON.parse(nativeResult.stdout.trim());

  let hummingbotProbe = {
    schemaVersion: "1.0.0",
    providerId: "hummingbot-poc:bitget-perpetual",
    status: "blocked",
    symbol: options.symbol,
    samples: [],
    requestAttempts: null,
    limitations: ["hummingbot_runtime_unavailable"]
  };

  const hummingbotRoot = String(process.env.HB_POC_HUMMINGBOT_ROOT ?? "").trim();
  if (hummingbotRoot) {
    const revision = await execFileAsync("git", ["-C", hummingbotRoot, "rev-parse", "HEAD"], { env, timeout: 5_000 });
    if (revision.stdout.trim() !== versions.hummingbot.commit) throw new Error("hummingbot_revision_mismatch");
    const status = await execFileAsync("git", ["-C", hummingbotRoot, "status", "--porcelain=v1", "--untracked-files=all", "--ignored=matching"], { env, timeout: 5_000 });
    if (status.stdout.trim()) throw new Error("hummingbot_checkout_not_clean");
    const python = String(process.env.HB_POC_PYTHON ?? "python3");
    if (!path.isAbsolute(python)) throw new Error("hummingbot_python_path_must_be_absolute");
    const remainingMs = Math.max(1, processDeadlineMs - (Date.now() - processStartedAt));
    const result = await execFileAsync(python, [
      path.join(directory, "hummingbot-public-probe.py"),
      JSON.stringify({ pair: options.symbol.replace(/(USDT|USDC|USD)$/, "-$1"), depth: options.depth })
    ], {
      cwd: hummingbotRoot,
      env: { ...env, PYTHONPATH: hummingbotRoot },
      timeout: remainingMs,
      maxBuffer: 2_000_000
    });
    hummingbotProbe = JSON.parse(result.stdout.trim().split("\n").at(-1));
  }

  const report = {
    generatedAt: new Date().toISOString(),
    pinnedVersions: versions,
    evidence: {
      native: nativeProbe,
      hummingbot: hummingbotProbe,
      comparison: comparePublicProbes(nativeProbe, hummingbotProbe)
    }
  };
  const serialized = `${JSON.stringify(report, null, 2)}\n`;
  if (options.output) await writeFile(path.resolve(options.output), serialized, { encoding: "utf8", flag: "wx" });
  process.stdout.write(serialized);
} finally {
  await rm(temporaryHome, { recursive: true, force: true });
}
