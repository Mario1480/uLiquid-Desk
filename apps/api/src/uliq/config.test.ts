import assert from "node:assert/strict";
import test from "node:test";
import { getUliqFeatureFlags, getUliqRuntimeConfig, ULIQ_RESERVATION_TTL_MS } from "./config.js";

const ADDRESS = "0x1111111111111111111111111111111111111111";

test("ULIQ flags default to fail closed", () => {
  assert.deepEqual(getUliqFeatureFlags({}), {
    enabled: false,
    presaleEnabled: false,
    discountsEnabled: false,
    lockingEnabled: false,
    adminEnabled: false
  });
  assert.equal(ULIQ_RESERVATION_TTL_MS, 600_000);
});

test("ULIQ rejects any production activation", () => {
  assert.throws(
    () => getUliqFeatureFlags({ NODE_ENV: "production", ULIQ_ENABLED: "true" }),
    /uliq_production_activation_forbidden/
  );
});

test("ULIQ runtime accepts only Arbitrum Sepolia with distinct RPCs", () => {
  const base = {
    ULIQ_ENABLED: "true",
    ULIQ_CHAIN_ID: "421614",
    ULIQ_RPC_PRIMARY_URL: "https://primary.example/rpc",
    ULIQ_RPC_SECONDARY_URL: "https://secondary.example/rpc",
    ULIQ_TOKEN_ADDRESS: ADDRESS,
    ULIQ_PRESALE_ADDRESS: ADDRESS,
    ULIQ_VESTING_ADDRESS: ADDRESS,
    ULIQ_LOCKER_ADDRESS: ADDRESS,
    ULIQ_USDC_ADDRESS: ADDRESS,
    ULIQ_START_BLOCK: "123"
  };
  assert.equal(getUliqRuntimeConfig(base).chainId, 421614);
  assert.equal(getUliqRuntimeConfig(base).startBlock, 123n);
  assert.throws(() => getUliqRuntimeConfig({ ...base, ULIQ_CHAIN_ID: "42161" }), /uliq_testnet_chain_required/);
  assert.throws(
    () => getUliqRuntimeConfig({ ...base, ULIQ_RPC_SECONDARY_URL: base.ULIQ_RPC_PRIMARY_URL }),
    /uliq_distinct_rpc_required/
  );
});
