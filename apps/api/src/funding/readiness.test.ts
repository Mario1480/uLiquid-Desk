import assert from "node:assert/strict";
import test from "node:test";
import { evaluateFundingReadiness } from "./readiness.js";
import type {
  ArbitrumBalances,
  FundingBalance,
  HyperCoreBalances,
  HyperEvmBalances,
  MasterVaultReadiness
} from "./types.js";

function available(symbol: string, formatted: string, decimals: number): FundingBalance {
  return {
    symbol,
    decimals,
    raw: "1",
    formatted,
    state: Number(formatted) > 0 ? "available" : "zero",
    available: true,
    reason: null
  };
}

function unavailable(symbol: string, decimals: number, reason = "unavailable"): FundingBalance {
  return {
    symbol,
    decimals,
    raw: null,
    formatted: null,
    state: "unavailable",
    available: false,
    reason
  };
}

function makeInput(params?: {
  arbUsdc?: FundingBalance;
  arbEth?: FundingBalance;
  coreUsdc?: FundingBalance;
  coreHype?: FundingBalance;
  evmUsdc?: FundingBalance;
  evmHype?: FundingBalance;
  masterVault?: Partial<MasterVaultReadiness>;
}) {
  const arbitrum: ArbitrumBalances = {
    location: "arbitrum",
    chainId: 42161,
    networkName: "Arbitrum",
    rpcUrl: "https://arb1.arbitrum.io/rpc",
    explorerUrl: "https://arbiscan.io",
    address: "0x1234567890123456789012345678901234567890",
    usdc: params?.arbUsdc ?? available("USDC", "0", 6),
    eth: params?.arbEth ?? available("ETH", "0", 18),
    updatedAt: "2026-03-10T00:00:00.000Z"
  };
  const hyperCore: HyperCoreBalances = {
    location: "hyperCore",
    address: arbitrum.address,
    source: "spotClearinghouseState",
    available: true,
    reason: null,
    usdc: params?.coreUsdc ?? available("USDC", "0", 6),
    hype: params?.coreHype ?? available("HYPE", "0", 18),
    updatedAt: "2026-03-10T00:00:00.000Z"
  };
  const hyperEvm: HyperEvmBalances = {
    location: "hyperEvm",
    chainId: 999,
    networkName: "HyperEVM",
    rpcUrl: "https://rpc.hyperliquid.xyz/evm",
    explorerUrl: "https://app.hyperliquid.xyz/explorer",
    address: arbitrum.address,
    usdc: params?.evmUsdc ?? available("USDC", "0", 6),
    hype: params?.evmHype ?? available("HYPE", "0", 18),
    updatedAt: "2026-03-10T00:00:00.000Z"
  };
  const masterVault: MasterVaultReadiness = {
    location: "masterVault",
    configured: true,
    writeEnabled: true,
    address: "0x9999999999999999999999999999999999999999",
    reasons: [],
    status: "ready",
    ...params?.masterVault
  };

  return { arbitrum, hyperCore, hyperEvm, masterVault };
}

test("readiness recommends funding Arbitrum USDC first", () => {
  const readiness = evaluateFundingReadiness(makeInput());
  assert.equal(readiness.recommendedAction, "fund_arbitrum_usdc");
  assert.equal(readiness.currentStage, "arbitrum_usdc");
});

test("readiness recommends funding Arbitrum ETH after USDC exists", () => {
  const readiness = evaluateFundingReadiness(
    makeInput({
      arbUsdc: available("USDC", "120", 6)
    })
  );
  assert.equal(readiness.recommendedAction, "fund_arbitrum_eth");
});

test("readiness recommends Hyperliquid deposit when Arbitrum is funded but HyperCore USDC is missing", () => {
  const readiness = evaluateFundingReadiness(
    makeInput({
      arbUsdc: available("USDC", "120", 6),
      arbEth: available("ETH", "0.05", 18)
    })
  );
  assert.equal(readiness.recommendedAction, "deposit_usdc_to_hyperliquid");
});

test("readiness recommends HYPE bootstrap when neither Core nor EVM has HYPE", () => {
  const readiness = evaluateFundingReadiness(
    makeInput({
      arbUsdc: available("USDC", "120", 6),
      arbEth: available("ETH", "0.05", 18),
      coreUsdc: available("USDC", "120", 6)
    })
  );
  assert.equal(readiness.recommendedAction, "obtain_hype_bootstrap");
});

test("readiness recommends USDC transfer when HyperCore has USDC and HyperEVM has none", () => {
  const readiness = evaluateFundingReadiness(
    makeInput({
      arbUsdc: available("USDC", "120", 6),
      arbEth: available("ETH", "0.05", 18),
      coreUsdc: available("USDC", "120", 6),
      coreHype: available("HYPE", "5", 18)
    })
  );
  assert.equal(readiness.recommendedAction, "transfer_usdc_core_to_evm");
});

test("readiness recommends HYPE transfer when HyperCore has HYPE and HyperEVM has none", () => {
  const readiness = evaluateFundingReadiness(
    makeInput({
      arbUsdc: available("USDC", "120", 6),
      arbEth: available("ETH", "0.05", 18),
      coreUsdc: available("USDC", "120", 6),
      coreHype: available("HYPE", "5", 18),
      evmUsdc: available("USDC", "120", 6)
    })
  );
  assert.equal(readiness.recommendedAction, "transfer_hype_core_to_evm");
});

test("readiness recommends MasterVault deposit when HyperEVM has USDC and HYPE", () => {
  const readiness = evaluateFundingReadiness(
    makeInput({
      arbUsdc: available("USDC", "120", 6),
      arbEth: available("ETH", "0.05", 18),
      evmUsdc: available("USDC", "120", 6),
      evmHype: available("HYPE", "1", 18)
    })
  );
  assert.equal(readiness.recommendedAction, "deposit_master_vault");
  assert.equal(readiness.depositEnabled, true);
});

test("readiness marks deposit disabled when MasterVault config is blocked", () => {
  const readiness = evaluateFundingReadiness(
    makeInput({
      arbUsdc: available("USDC", "120", 6),
      arbEth: available("ETH", "0.05", 18),
      evmUsdc: available("USDC", "120", 6),
      evmHype: available("HYPE", "1", 18),
      masterVault: {
        configured: false,
        writeEnabled: false,
        reasons: ["invalid_master_vault_address"],
        status: "blocked"
      }
    })
  );
  assert.equal(readiness.depositEnabled, false);
  assert.equal(readiness.currentStage, "mastervault_ready");
});

test("readiness treats HyperCore stages as non-blocking once HyperEVM already has funds", () => {
  const readiness = evaluateFundingReadiness(
    makeInput({
      arbUsdc: available("USDC", "120", 6),
      arbEth: available("ETH", "0.05", 18),
      evmUsdc: available("USDC", "120", 6),
      evmHype: available("HYPE", "1", 18)
    })
  );
  const coreUsdcStage = readiness.stages.find((item) => item.id === "hypercore_usdc");
  const coreHypeStage = readiness.stages.find((item) => item.id === "hypercore_hype");
  assert.equal(coreUsdcStage?.status, "success");
  assert.equal(coreHypeStage?.status, "success");
});

test("readiness surfaces unavailable sources as warnings without producing a false ready state", () => {
  const readiness = evaluateFundingReadiness(
    makeInput({
      arbUsdc: unavailable("USDC", 6),
      coreUsdc: unavailable("USDC", 6, "hypercore_down"),
      evmUsdc: unavailable("USDC", 6, "rpc_down")
    })
  );
  assert.equal(readiness.currentStage, "arbitrum_usdc");
  assert.equal(readiness.depositEnabled, false);
  assert.equal(readiness.stages.some((item) => item.status === "warning"), true);
});
