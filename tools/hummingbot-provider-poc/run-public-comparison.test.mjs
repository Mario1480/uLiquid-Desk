import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import test from "node:test";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const directory = path.dirname(fileURLToPath(import.meta.url));
const runner = path.join(directory, "run-public-comparison.mjs");

async function rejectedOutput(env) {
  try {
    await execFileAsync(process.execPath, [runner, "--samples", "1"], {
      env,
      timeout: 5_000,
      maxBuffer: 100_000
    });
  } catch (error) {
    return `${error.stdout ?? ""}\n${error.stderr ?? ""}`;
  }
  assert.fail("runner unexpectedly succeeded");
}

test("runner is disabled unless public POC opt-in is explicit", async () => {
  const env = { ...process.env };
  delete env.ULIQ_HB_POC_ENABLED;
  const output = await rejectedOutput(env);
  assert.match(output, /POC is disabled/);
});

test("runner rejects Bitget credentials before starting a child", async () => {
  const syntheticSecret = "synthetic-secret-that-must-not-be-echoed";
  const output = await rejectedOutput({
    ...process.env,
    ULIQ_HB_POC_ENABLED: "true",
    BITGET_API_SECRET: syntheticSecret
  });
  assert.match(output, /poc_credentials_forbidden:BITGET_API_SECRET/);
  assert.doesNotMatch(output, new RegExp(syntheticSecret));
});
