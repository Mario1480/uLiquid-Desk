import assert from "node:assert/strict";
import test from "node:test";
import {
  getVaultExecutionModeSettings,
  setVaultExecutionModeSettings,
  resolveDefaultVaultExecutionMode
} from "./executionMode.js";

function createDb(initial: unknown = null) {
  let value = initial;
  let updatedAt = new Date("2026-01-01T00:00:00.000Z");
  return {
    globalSetting: {
      async findUnique() {
        return value == null ? null : { value, updatedAt };
      },
      async upsert(input: any) {
        value = input.update?.value ?? input.create?.value ?? null;
        updatedAt = new Date("2026-01-01T00:00:01.000Z");
        return { updatedAt };
      }
    }
  };
}

test("resolveDefaultVaultExecutionMode falls back to offchain_shadow", () => {
  assert.equal(resolveDefaultVaultExecutionMode(""), "offchain_shadow");
  assert.equal(resolveDefaultVaultExecutionMode("invalid"), "offchain_shadow");
});

test("getVaultExecutionModeSettings prefers db mode", async () => {
  const db = createDb({ mode: "onchain_live" });
  const settings = await getVaultExecutionModeSettings(db as any);
  assert.equal(settings.mode, "onchain_live");
  assert.equal(settings.source, "db");
});

test("setVaultExecutionModeSettings persists valid mode", async () => {
  const db = createDb();
  const saved = await setVaultExecutionModeSettings(db as any, "onchain_simulated");
  assert.equal(saved.mode, "onchain_simulated");
  assert.equal(saved.source, "db");
});
