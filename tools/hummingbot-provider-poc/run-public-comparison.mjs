import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
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
  const values = { symbol: "BTCUSDT", samples: 3, depth: 25, timeoutMs: 10_000, hummingbotRuns: 1, output: null };
  for (let index = 2; index < process.argv.length; index += 1) {
    const key = process.argv[index];
    const value = process.argv[index + 1];
    if (key === "--symbol") values.symbol = value, index += 1;
    else if (key === "--samples") values.samples = Number(value), index += 1;
    else if (key === "--depth") values.depth = Number(value), index += 1;
    else if (key === "--timeout-ms") values.timeoutMs = Number(value), index += 1;
    else if (key === "--hummingbot-runs") values.hummingbotRuns = Number(value), index += 1;
    else if (key === "--output") values.output = value, index += 1;
  }
  if (!Number.isInteger(values.hummingbotRuns) || values.hummingbotRuns < 1 || values.hummingbotRuns > 3) {
    throw new Error("hummingbot_runs_must_be_between_1_and_3");
  }
  return values;
}

async function assertPinnedSource(hummingbotRoot, env) {
  const revision = await execFileAsync("git", ["-C", hummingbotRoot, "rev-parse", "HEAD"], { env, timeout: 5_000 });
  if (revision.stdout.trim() !== versions.hummingbot.commit) throw new Error("hummingbot_revision_mismatch");
  const status = await execFileAsync("git", ["-C", hummingbotRoot, "status", "--porcelain=v1", "--untracked-files=all", "--ignored=matching"], { env, timeout: 5_000 });
  if (status.stdout.trim()) throw new Error("hummingbot_checkout_not_clean");
  const connectorRoot = path.join(hummingbotRoot, "hummingbot", "connector", "derivative", "bitget_perpetual");
  for (const [file, expected] of Object.entries(versions.hummingbot.connectorSourceSha256)) {
    const digest = createHash("sha256").update(await readFile(path.join(connectorRoot, file))).digest("hex");
    if (digest !== expected) throw new Error(`hummingbot_connector_source_mismatch:${file}`);
  }
}

function parseProbeOutput(stdout) {
  return JSON.parse(stdout.trim().split("\n").at(-1));
}

function mergeDockerProbes(probes, runtimeRuns) {
  const first = probes[0];
  const limitations = [...new Set(probes.flatMap((probe) => probe.limitations ?? []))];
  return {
    ...first,
    samples: probes.flatMap((probe) => probe.samples ?? []),
    resourceUsage: {
      cpuSeconds: probes.reduce((total, probe) => total + Number(probe.resourceUsage?.cpuSeconds ?? 0), 0),
      maxRssBytes: Math.max(...probes.map((probe) => Number(probe.resourceUsage?.maxRssBytes ?? 0)))
    },
    websocketReconnect: probes.find((probe) => probe.websocketReconnect?.attempted)?.websocketReconnect ?? { attempted: false },
    runtimeRuns,
    limitations
  };
}

async function runDockerProbe(options, env, processDeadlineMs, processStartedAt) {
  const docker = String(process.env.HB_POC_DOCKER_BIN ?? "").trim();
  const dockerHost = String(process.env.HB_POC_DOCKER_HOST ?? "").trim();
  if (!path.isAbsolute(docker)) throw new Error("hummingbot_docker_path_must_be_absolute");
  if (!dockerHost.startsWith("unix://")) throw new Error("hummingbot_docker_host_must_be_unix_socket");
  const dockerEnv = { ...env, DOCKER_HOST: dockerHost };
  const image = versions.hummingbot.dockerImage;
  const imageCheck = await execFileAsync(docker, ["image", "inspect", image, "--format", "{{join .RepoDigests \"\\n\"}}"], {
    env: dockerEnv,
    timeout: 10_000
  });
  if (!imageCheck.stdout.includes(image.split("@")[1])) throw new Error("hummingbot_docker_image_digest_unavailable");
  const connectorFiles = Object.keys(versions.hummingbot.connectorSourceSha256);
  const connectorRoot = "/home/hummingbot/hummingbot/connector/derivative/bitget_perpetual";
  const imageHashes = await execFileAsync(docker, [
    "run", "--rm", "--pull", "never", "--network", "none", "--read-only",
    "--cap-drop", "ALL", "--security-opt", "no-new-privileges",
    "--entrypoint", "/usr/bin/sha256sum", image,
    ...connectorFiles.map((file) => `${connectorRoot}/${file}`)
  ], { env: dockerEnv, timeout: 15_000, maxBuffer: 100_000 });
  const observedHashes = new Map(imageHashes.stdout.trim().split("\n").map((line) => {
    const [digest, file] = line.trim().split(/\s+/, 2);
    return [path.basename(file), digest];
  }));
  for (const [file, expected] of Object.entries(versions.hummingbot.connectorSourceSha256)) {
    if (observedHashes.get(file) !== expected) throw new Error(`hummingbot_docker_connector_mismatch:${file}`);
  }

  const probePath = path.join(directory, "hummingbot-public-probe.py");
  const probes = [];
  const runtimeRuns = [];
  for (let index = 0; index < options.hummingbotRuns; index += 1) {
    const remainingMs = Math.max(1, processDeadlineMs - (Date.now() - processStartedAt));
    const startedAt = Date.now();
    const result = await execFileAsync(docker, [
      "run", "--rm", "--pull", "never", "--network", "bridge", "--read-only",
      "--tmpfs", "/tmp:rw,noexec,nosuid,size=128m",
      "--tmpfs", "/home/hummingbot/conf:rw,noexec,nosuid,size=16m",
      "--tmpfs", "/home/hummingbot/logs:rw,noexec,nosuid,size=32m",
      "--cpus", "2", "--memory", "2g", "--pids-limit", "256",
      "--cap-drop", "ALL", "--security-opt", "no-new-privileges",
      "-e", "HOME=/tmp", "-e", "PYTHONPATH=/home/hummingbot", "-e", "ULIQ_HB_POC_ENABLED=true",
      "-v", `${probePath}:/opt/uliq-poc/hummingbot-public-probe.py:ro`,
      "--entrypoint", "/opt/conda/envs/hummingbot/bin/python",
      image, "-B", "/opt/uliq-poc/hummingbot-public-probe.py",
      JSON.stringify({ pair: options.symbol.replace(/(USDT|USDC|USD)$/, "-$1"), depth: options.depth, reconnectCheck: index === 0 })
    ], { env: dockerEnv, timeout: remainingMs, maxBuffer: 2_000_000 });
    const probe = parseProbeOutput(result.stdout);
    probes.push(probe);
    runtimeRuns.push({
      sequence: index + 1,
      status: probe.status,
      durationMs: Date.now() - startedAt,
      cpuSeconds: probe.resourceUsage?.cpuSeconds ?? null,
      maxRssBytes: probe.resourceUsage?.maxRssBytes ?? null
    });
  }
  return mergeDockerProbes(probes, runtimeRuns);
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
    await assertPinnedSource(hummingbotRoot, env);
    if (process.env.HB_POC_RUNTIME === "docker") {
      hummingbotProbe = await runDockerProbe(options, env, processDeadlineMs, processStartedAt);
    } else {
      const python = String(process.env.HB_POC_PYTHON ?? "python3");
      if (!path.isAbsolute(python)) throw new Error("hummingbot_python_path_must_be_absolute");
      const remainingMs = Math.max(1, processDeadlineMs - (Date.now() - processStartedAt));
      const result = await execFileAsync(python, [
        path.join(directory, "hummingbot-public-probe.py"),
        JSON.stringify({ pair: options.symbol.replace(/(USDT|USDC|USD)$/, "-$1"), depth: options.depth, reconnectCheck: true })
      ], {
        cwd: hummingbotRoot,
        env: { ...env, PYTHONPATH: hummingbotRoot },
        timeout: remainingMs,
        maxBuffer: 2_000_000
      });
      hummingbotProbe = parseProbeOutput(result.stdout);
    }
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
