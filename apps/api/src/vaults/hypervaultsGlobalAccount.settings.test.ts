import assert from "node:assert/strict";
import test from "node:test";
import {
  disableHypervaultsGlobalAccount,
  getHypervaultsGlobalAccountPublicState,
  resolveHypervaultsGlobalAccount,
  setHypervaultsGlobalAccount
} from "./hypervaultsGlobalAccount.settings.js";

function createDb() {
  let row: { value: unknown; updatedAt: Date } | null = null;
  return {
    globalSetting: {
      async findUnique() {
        return row;
      },
      async upsert(args: any) {
        row = {
          value: args.update.value,
          updatedAt: new Date("2026-03-11T10:00:00.000Z")
        };
        return row;
      }
    }
  } as any;
}

test("hypervaults global execution account stores encrypted values and resolves public state", async () => {
  process.env.SECRET_MASTER_KEY = process.env.SECRET_MASTER_KEY || "0123456789abcdef0123456789abcdef";
  const db = createDb();

  const saved = await setHypervaultsGlobalAccount(db, {
    enabled: true,
    apiKey: "0x1111111111111111111111111111111111111111",
    apiSecret: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    vaultAddress: "0x2222222222222222222222222222222222222222"
  });

  assert.equal(saved.enabled, true);
  assert.equal(saved.configured, true);
  assert.equal(saved.valid, true);
  assert.equal(saved.status, "ready");
  assert.equal(saved.apiKeyMasked, "0x1111...1111");

  const resolved = await resolveHypervaultsGlobalAccount(db);
  assert.equal(resolved?.apiKey, "0x1111111111111111111111111111111111111111");
  assert.equal(resolved?.vaultAddress, "0x2222222222222222222222222222222222222222");

  const publicState = await getHypervaultsGlobalAccountPublicState(db);
  assert.equal(publicState.status, "ready");
  assert.equal(publicState.credentialSource, "global_admin");
  assert.equal(typeof publicState.globalExecutionAccountId, "string");
});

test("hypervaults global execution account can be disabled without deleting secrets", async () => {
  process.env.SECRET_MASTER_KEY = process.env.SECRET_MASTER_KEY || "0123456789abcdef0123456789abcdef";
  const db = createDb();
  await setHypervaultsGlobalAccount(db, {
    enabled: true,
    apiKey: "0x1111111111111111111111111111111111111111",
    apiSecret: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
  });

  const disabled = await disableHypervaultsGlobalAccount(db);
  assert.equal(disabled.enabled, false);
  assert.equal(disabled.configured, true);
  assert.equal(disabled.status, "disabled");
  assert.equal(await resolveHypervaultsGlobalAccount(db), null);
});
