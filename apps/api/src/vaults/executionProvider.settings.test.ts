import assert from "node:assert/strict";
import test from "node:test";
import {
  getEffectiveVaultExecutionProvider,
  getVaultExecutionProviderSettings,
  resolveDefaultExecutionProvider,
  setVaultExecutionProviderSettings
} from "./executionProvider.settings.js";

function createGlobalSettingDb(initialValue: unknown = null, initialUpdatedAt: Date | null = null) {
  let value = initialValue;
  let updatedAt = initialUpdatedAt;
  return {
    globalSetting: {
      async findUnique() {
        if (value == null) return null;
        return { value, updatedAt };
      },
      async upsert(args: any) {
        value = args.update.value;
        updatedAt = new Date("2026-03-08T10:00:00.000Z");
        return { updatedAt };
      }
    }
  };
}

test("vault execution provider settings default to mock unless hyperliquid_demo env is set", async () => {
  assert.equal(resolveDefaultExecutionProvider(undefined), "mock");
  assert.equal(resolveDefaultExecutionProvider("hyperliquid_demo"), "hyperliquid_demo");
  assert.equal(resolveDefaultExecutionProvider("hyperliquid"), "mock");
});

test("vault execution provider settings read and persist hyperliquid_demo", async () => {
  const db = createGlobalSettingDb();

  const before = await getVaultExecutionProviderSettings(db);
  assert.equal(before.provider, "mock");
  assert.equal(before.source, "env");

  const saved = await setVaultExecutionProviderSettings(db, "hyperliquid_demo");
  assert.equal(saved.provider, "hyperliquid_demo");
  assert.equal(saved.source, "db");

  const after = await getVaultExecutionProviderSettings(db);
  assert.equal(after.provider, "hyperliquid_demo");
  assert.equal(after.source, "db");
  assert.equal(await getEffectiveVaultExecutionProvider(db), "hyperliquid_demo");
});
