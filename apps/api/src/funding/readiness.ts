import { formatUnits } from "viem";
import type {
  FundingActionId,
  FundingBalance,
  FundingReadiness,
  FundingStage,
  FundingStageId,
  HyperCoreBalances,
  HyperEvmBalances,
  MasterVaultReadiness
} from "./types.js";
import type { ArbitrumBalances } from "./types.js";

type EvaluateFundingReadinessInput = {
  arbitrum: ArbitrumBalances;
  hyperCore: HyperCoreBalances;
  hyperEvm: HyperEvmBalances;
  masterVault: MasterVaultReadiness;
  updatedAt?: string;
};

function numericBalance(balance: FundingBalance): number | null {
  if (!balance.available || balance.formatted === null) return null;
  const parsed = Number(balance.formatted);
  return Number.isFinite(parsed) ? parsed : null;
}

function balanceLabel(balance: FundingBalance): string | null {
  if (!balance.available || balance.formatted === null) return null;
  return `${balance.formatted} ${balance.symbol}`;
}

function stage(
  id: FundingStageId,
  input: Omit<FundingStage, "id">
): FundingStage {
  return { id, ...input };
}

function describeUnavailable(balance: FundingBalance, fallback: string): string {
  return balance.reason ?? fallback;
}

export function evaluateFundingReadiness(input: EvaluateFundingReadinessInput): FundingReadiness {
  const updatedAt = input.updatedAt ?? new Date().toISOString();
  const arbUsdc = numericBalance(input.arbitrum.usdc);
  const arbEth = numericBalance(input.arbitrum.eth);
  const coreUsdc = numericBalance(input.hyperCore.usdc);
  const coreHype = numericBalance(input.hyperCore.hype);
  const evmUsdc = numericBalance(input.hyperEvm.usdc);
  const evmHype = numericBalance(input.hyperEvm.hype);

  const stages: FundingStage[] = [];
  const missingRequirements: string[] = [];

  stages.push(
    !input.arbitrum.usdc.available
      ? stage("arbitrum_usdc", {
          status: "warning",
          balanceLabel: null,
          detail: describeUnavailable(input.arbitrum.usdc, "Arbitrum USDC balance unavailable."),
          actionId: "deposit_usdc_to_hyperliquid",
          blocking: true
        })
      : (arbUsdc ?? 0) > 0
        ? stage("arbitrum_usdc", {
            status: "success",
            balanceLabel: balanceLabel(input.arbitrum.usdc),
            detail: "Arbitrum USDC available.",
            actionId: null,
            blocking: true
          })
        : stage("arbitrum_usdc", {
            status: "missing",
            balanceLabel: balanceLabel(input.arbitrum.usdc),
            detail: "Add USDC to Arbitrum before starting the Hyperliquid deposit flow.",
            actionId: "fund_arbitrum_usdc",
            blocking: true
          })
  );

  stages.push(
    !input.arbitrum.eth.available
      ? stage("arbitrum_eth", {
          status: "warning",
          balanceLabel: null,
          detail: describeUnavailable(input.arbitrum.eth, "Arbitrum ETH balance unavailable."),
          actionId: "fund_arbitrum_eth",
          blocking: true
        })
      : (arbEth ?? 0) > 0
        ? stage("arbitrum_eth", {
            status: "success",
            balanceLabel: balanceLabel(input.arbitrum.eth),
            detail: "Arbitrum ETH available for deposit gas.",
            actionId: null,
            blocking: true
          })
        : stage("arbitrum_eth", {
            status: "missing",
            balanceLabel: balanceLabel(input.arbitrum.eth),
            detail: "Arbitrum deposit requires ETH for gas.",
            actionId: "fund_arbitrum_eth",
            blocking: true
          })
  );

  const hyperCoreUsdcNonBlocking = (evmUsdc ?? 0) > 0;
  stages.push(
    !input.hyperCore.usdc.available
      ? stage("hypercore_usdc", {
          status: "warning",
          balanceLabel: null,
          detail: describeUnavailable(input.hyperCore.usdc, "HyperCore USDC balance unavailable."),
          actionId: hyperCoreUsdcNonBlocking ? null : "deposit_usdc_to_hyperliquid",
          blocking: !hyperCoreUsdcNonBlocking
        })
      : (coreUsdc ?? 0) > 0
        ? stage("hypercore_usdc", {
            status: "success",
            balanceLabel: balanceLabel(input.hyperCore.usdc),
            detail: "HyperCore USDC available for Core -> EVM transfer.",
            actionId: null,
            blocking: !hyperCoreUsdcNonBlocking
          })
        : hyperCoreUsdcNonBlocking
          ? stage("hypercore_usdc", {
              status: "success",
              balanceLabel: balanceLabel(input.hyperCore.usdc),
              detail: "HyperEVM already has USDC, so HyperCore USDC is not required right now.",
              actionId: null,
              blocking: false
            })
          : stage("hypercore_usdc", {
              status: "missing",
              balanceLabel: balanceLabel(input.hyperCore.usdc),
              detail: "Deposit USDC into Hyperliquid before moving funds to HyperEVM.",
              actionId: "deposit_usdc_to_hyperliquid",
              blocking: true
            })
  );

  const hyperCoreHypeNonBlocking = (evmHype ?? 0) > 0;
  stages.push(
    !input.hyperCore.hype.available
      ? stage("hypercore_hype", {
          status: "warning",
          balanceLabel: null,
          detail: describeUnavailable(input.hyperCore.hype, "HyperCore HYPE balance unavailable."),
          actionId: hyperCoreHypeNonBlocking ? null : "obtain_hype_bootstrap",
          blocking: !hyperCoreHypeNonBlocking
        })
      : (coreHype ?? 0) > 0
        ? stage("hypercore_hype", {
            status: "success",
            balanceLabel: balanceLabel(input.hyperCore.hype),
            detail: "HyperCore HYPE available for gas bootstrap.",
            actionId: null,
            blocking: !hyperCoreHypeNonBlocking
          })
        : hyperCoreHypeNonBlocking
          ? stage("hypercore_hype", {
              status: "success",
              balanceLabel: balanceLabel(input.hyperCore.hype),
              detail: "HyperEVM already has HYPE, so HyperCore HYPE is not required right now.",
              actionId: null,
              blocking: false
            })
          : stage("hypercore_hype", {
              status: "missing",
              balanceLabel: balanceLabel(input.hyperCore.hype),
              detail: "Bootstrap HYPE before moving funds to HyperEVM.",
              actionId: "obtain_hype_bootstrap",
              blocking: true
            })
  );

  stages.push(
    !input.hyperEvm.usdc.available
      ? stage("hyperevm_usdc", {
          status: "warning",
          balanceLabel: null,
          detail: describeUnavailable(input.hyperEvm.usdc, "HyperEVM USDC balance unavailable."),
          actionId: "transfer_usdc_core_to_evm",
          blocking: true
        })
      : (evmUsdc ?? 0) > 0
        ? stage("hyperevm_usdc", {
            status: "success",
            balanceLabel: balanceLabel(input.hyperEvm.usdc),
            detail: "HyperEVM USDC available for MasterVault deposit.",
            actionId: null,
            blocking: true
          })
        : stage("hyperevm_usdc", {
            status: "missing",
            balanceLabel: balanceLabel(input.hyperEvm.usdc),
            detail: (coreUsdc ?? 0) > 0
              ? "Move USDC from HyperCore to HyperEVM."
              : "HyperEVM still needs USDC before deposit.",
            actionId: "transfer_usdc_core_to_evm",
            blocking: true
          })
  );

  stages.push(
    !input.hyperEvm.hype.available
      ? stage("hyperevm_hype", {
          status: "warning",
          balanceLabel: null,
          detail: describeUnavailable(input.hyperEvm.hype, "HyperEVM HYPE balance unavailable."),
          actionId: "transfer_hype_core_to_evm",
          blocking: true
        })
      : (evmHype ?? 0) > 0
        ? stage("hyperevm_hype", {
            status: "success",
            balanceLabel: balanceLabel(input.hyperEvm.hype),
            detail: "HyperEVM HYPE available for gas.",
            actionId: null,
            blocking: true
          })
        : stage("hyperevm_hype", {
            status: "missing",
            balanceLabel: balanceLabel(input.hyperEvm.hype),
            detail: (coreHype ?? 0) > 0
              ? "Move HYPE from HyperCore to HyperEVM for gas."
              : "HyperEVM gas uses HYPE, not ETH.",
            actionId: "transfer_hype_core_to_evm",
            blocking: true
          })
  );

  const depositFundsReady = (evmUsdc ?? 0) > 0 && (evmHype ?? 0) > 0;
  const depositEnabled = depositFundsReady && input.masterVault.writeEnabled;
  stages.push(
    depositEnabled
      ? stage("mastervault_ready", {
          status: "success",
          balanceLabel: input.masterVault.address,
          detail: "MasterVault deposit is ready.",
          actionId: "deposit_master_vault",
          blocking: true
        })
      : stage("mastervault_ready", {
          status: input.masterVault.configured ? "missing" : "warning",
          balanceLabel: input.masterVault.address,
          detail: !input.masterVault.configured
            ? "MasterVault config is incomplete."
            : "HyperEVM USDC and HYPE are required before deposit.",
          actionId: "deposit_master_vault",
          blocking: true
        })
  );

  for (const item of stages) {
    if (item.status === "missing" || (item.status === "warning" && item.blocking)) {
      missingRequirements.push(item.id);
    }
  }

  let recommendedAction: FundingActionId = "ready";
  if (input.arbitrum.usdc.available && (arbUsdc ?? 0) <= 0) {
    recommendedAction = "fund_arbitrum_usdc";
  } else if (input.arbitrum.eth.available && (arbEth ?? 0) <= 0) {
    recommendedAction = "fund_arbitrum_eth";
  } else if ((coreUsdc ?? 0) <= 0 && (evmUsdc ?? 0) <= 0) {
    recommendedAction = "deposit_usdc_to_hyperliquid";
  } else if ((coreHype ?? 0) <= 0 && (evmHype ?? 0) <= 0) {
    recommendedAction = "obtain_hype_bootstrap";
  } else if ((evmUsdc ?? 0) <= 0 && (coreUsdc ?? 0) > 0) {
    recommendedAction = "transfer_usdc_core_to_evm";
  } else if ((evmHype ?? 0) <= 0 && (coreHype ?? 0) > 0) {
    recommendedAction = "transfer_hype_core_to_evm";
  } else if ((evmUsdc ?? 0) > 0 && (evmHype ?? 0) > 0 && input.masterVault.configured) {
    recommendedAction = "deposit_master_vault";
  }

  const currentStage =
    stages.find((item) => item.status === "missing" || item.status === "warning")?.id
    ?? "ready";

  return {
    currentStage,
    missingRequirements,
    recommendedAction,
    depositEnabled,
    stages,
    updatedAt
  };
}
