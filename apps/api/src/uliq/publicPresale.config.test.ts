import assert from "node:assert/strict";
import test from "node:test";
import { getUliqPublicPresaleConfig, getUliqPublicPresaleFlags } from "./publicPresale.config.js";

const addresses = {
  ULIQ_PUBLIC_PRESALE_TOKEN_ADDRESS: "0x1111111111111111111111111111111111111111",
  ULIQ_PUBLIC_PRESALE_USDC_ADDRESS: "0x2222222222222222222222222222222222222222",
  ULIQ_PUBLIC_PRESALE_GLOBAL_LISTING_ADDRESS: "0x3333333333333333333333333333333333333333",
  ULIQ_PUBLIC_PRESALE_ROUND_1_ADDRESS: "0x4444444444444444444444444444444444444444",
  ULIQ_PUBLIC_PRESALE_ROUND_1_VESTING_ADDRESS: "0x5555555555555555555555555555555555555555",
  ULIQ_PUBLIC_PRESALE_ROUND_1_PAYMENT_CUSTODY_ADDRESS: "0x8888888888888888888888888888888888888888",
  ULIQ_PUBLIC_PRESALE_ROUND_1_INVENTORY_SOURCE_ADDRESS: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  ULIQ_PUBLIC_PRESALE_ROUND_2_ADDRESS: "0x6666666666666666666666666666666666666666",
  ULIQ_PUBLIC_PRESALE_ROUND_2_VESTING_ADDRESS: "0x7777777777777777777777777777777777777777",
  ULIQ_PUBLIC_PRESALE_ROUND_2_PAYMENT_CUSTODY_ADDRESS: "0x9999999999999999999999999999999999999999",
  ULIQ_PUBLIC_PRESALE_ROUND_2_INVENTORY_SOURCE_ADDRESS: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
};

const base = {
  ULIQ_PUBLIC_PRESALE_ENABLED: "true",
  ULIQ_PUBLIC_PRESALE_CHAIN_ID: "421614",
  ULIQ_PUBLIC_PRESALE_START_BLOCK: "123456",
  ULIQ_PUBLIC_PRESALE_RPC_PRIMARY_URL: "https://primary.example/rpc",
  ULIQ_PUBLIC_PRESALE_RPC_SECONDARY_URL: "https://secondary.example/rpc",
  ...addresses
};

test("public presale flags default to fail closed", () => {
  assert.deepEqual(getUliqPublicPresaleFlags({}), { enabled: false, purchasesEnabled: false });
  assert.throws(
    () => getUliqPublicPresaleFlags({ ULIQ_PUBLIC_PRESALE_PURCHASES_ENABLED: "true" }),
    /parent_disabled/
  );
});

test("public presale config carries the approved two-round economic parameters", () => {
  const config = getUliqPublicPresaleConfig(base);
  assert.equal(config.chainId, 421614);
  assert.equal(config.startBlock, 123456n);
  assert.equal(config.purchasesEnabled, false);
  assert.equal(config.rounds[0].expected.allocationUliqRaw, 50_000_000n * 10n ** 18n);
  assert.equal(config.rounds[0].expected.priceUsdcRawPerUliq, 2_000n);
  assert.equal(config.rounds[0].expected.minPurchaseUsdcRaw, 500n * 10n ** 6n);
  assert.equal(config.rounds[0].expected.maxPurchaseUsdcRaw, 10_000n * 10n ** 6n);
  assert.equal(config.rounds[0].inventorySourceAddress, addresses.ULIQ_PUBLIC_PRESALE_ROUND_1_INVENTORY_SOURCE_ADDRESS);
  assert.equal(config.rounds[1].expected.allocationUliqRaw, 100_000_000n * 10n ** 18n);
  assert.equal(config.rounds[1].expected.priceUsdcRawPerUliq, 3_500n);
  assert.equal(config.rounds[1].expected.minPurchaseUsdcRaw, 100n * 10n ** 6n);
  assert.equal(config.rounds[1].expected.maxPurchaseUsdcRaw, 5_000n * 10n ** 6n);
  assert.equal(config.rounds[1].inventorySourceAddress, addresses.ULIQ_PUBLIC_PRESALE_ROUND_2_INVENTORY_SOURCE_ADDRESS);
});

test("purchase activation requires versioned legal text", () => {
  assert.throws(
    () => getUliqPublicPresaleConfig({ ...base, ULIQ_PUBLIC_PRESALE_PURCHASES_ENABLED: "true" }),
    /terms_not_ready/
  );
  const config = getUliqPublicPresaleConfig({
    ...base,
    ULIQ_PUBLIC_PRESALE_PURCHASES_ENABLED: "true",
    ULIQ_PUBLIC_PRESALE_TERMS_VERSION: "2026-09-01",
    ULIQ_PUBLIC_PRESALE_TERMS_HASH: "ab".repeat(32)
  });
  assert.equal(config.purchasesEnabled, true);
  assert.equal(config.terms.ready, true);
});

test("mainnet purchase activation needs separate Mainnet and Legal approval flags in every environment", () => {
  const mainnet = {
    ...base,
    NODE_ENV: "development",
    ULIQ_PUBLIC_PRESALE_CHAIN_ID: "42161",
    ULIQ_PUBLIC_PRESALE_PURCHASES_ENABLED: "true",
    ULIQ_PUBLIC_PRESALE_TERMS_VERSION: "approved-v1",
    ULIQ_PUBLIC_PRESALE_TERMS_HASH: "cd".repeat(32)
  };
  assert.throws(() => getUliqPublicPresaleConfig(mainnet), /mainnet_activation_forbidden/);
  assert.equal(getUliqPublicPresaleConfig({
    ...mainnet,
    ULIQ_PUBLIC_PRESALE_MAINNET_APPROVED: "true",
    ULIQ_PUBLIC_PRESALE_LEGAL_APPROVED: "true"
  }).chainId, 42161);
});

test("public presale config rejects duplicate contracts and RPC endpoints", () => {
  assert.throws(
    () => getUliqPublicPresaleConfig({ ...base, ULIQ_PUBLIC_PRESALE_START_BLOCK: "0" }),
    /invalid_start_block/
  );
  assert.throws(
    () => getUliqPublicPresaleConfig({ ...base, ULIQ_PUBLIC_PRESALE_RPC_SECONDARY_URL: base.ULIQ_PUBLIC_PRESALE_RPC_PRIMARY_URL }),
    /distinct_rpc_required/
  );
  assert.throws(
    () => getUliqPublicPresaleConfig({ ...base, ULIQ_PUBLIC_PRESALE_ROUND_2_ADDRESS: addresses.ULIQ_PUBLIC_PRESALE_ROUND_1_ADDRESS }),
    /duplicate_contract_address/
  );
});
