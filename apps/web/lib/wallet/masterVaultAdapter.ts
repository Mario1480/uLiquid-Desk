import { isAddress } from "viem";
import type { Address, Abi } from "viem";
import type { WalletFeatureConfig, MasterVaultAdapterId } from "./types";

export type PreparedWriteCall = {
  address: Address;
  abi: Abi;
  functionName: string;
  args: readonly unknown[];
};

export type DepositBuildResult =
  | { ok: true; call: PreparedWriteCall }
  | { ok: false; reason: string };

export type WithdrawBuildResult =
  | { ok: true; call: PreparedWriteCall }
  | { ok: false; reason: string };

export type MasterVaultAdapter = {
  id: MasterVaultAdapterId;
  label: string;
  getAllowanceTarget(config: WalletFeatureConfig): Address | null;
  buildDepositCall(config: WalletFeatureConfig, owner: Address, amount: bigint): DepositBuildResult;
  buildWithdrawCall(config: WalletFeatureConfig, owner: Address, amount: bigint): WithdrawBuildResult;
};

function asAddress(value: string | null | undefined): Address | null {
  const raw = String(value ?? "").trim();
  return raw && isAddress(raw) ? (raw as Address) : null;
}

const legacyTokenAmountAdapter: MasterVaultAdapter = {
  id: "legacy_token_amount",
  label: "Legacy MasterVault",
  getAllowanceTarget(config) {
    return asAddress(config.masterVault.approveSpender) ?? asAddress(config.masterVault.address);
  },
  buildDepositCall(config, _owner, amount) {
    const address = asAddress(config.masterVault.address);
    const usdcAddress = asAddress(config.usdc.address);
    if (!address || !usdcAddress || !config.masterVault.abi) {
      return { ok: false, reason: "MasterVault config is incomplete." };
    }
    return {
      ok: true,
      call: {
        address,
        abi: config.masterVault.abi,
        functionName: config.masterVault.depositFunctionName || "deposit",
        args: [usdcAddress, amount]
      }
    };
  },
  buildWithdrawCall(config, _owner, amount) {
    const address = asAddress(config.masterVault.address);
    if (!address || !config.masterVault.abi) {
      return { ok: false, reason: "MasterVault config is incomplete." };
    }
    return {
      ok: true,
      call: {
        address,
        abi: config.masterVault.abi,
        functionName: "withdraw",
        args: [amount]
      }
    };
  }
};

const eip4626Adapter: MasterVaultAdapter = {
  id: "eip4626",
  label: "EIP-4626",
  getAllowanceTarget(config) {
    return asAddress(config.masterVault.approveSpender) ?? asAddress(config.masterVault.address);
  },
  buildDepositCall(config, owner, amount) {
    const address = asAddress(config.masterVault.address);
    if (!address || !config.masterVault.abi) {
      return { ok: false, reason: "MasterVault config is incomplete." };
    }
    return {
      ok: true,
      call: {
        address,
        abi: config.masterVault.abi,
        functionName: config.masterVault.depositFunctionName || "deposit",
        args: [amount, owner]
      }
    };
  },
  buildWithdrawCall() {
    return {
      ok: false,
      reason: "Withdraw is not configured for this MasterVault adapter yet."
    };
  }
};

const mockAdapter: MasterVaultAdapter = {
  id: "mock",
  label: "Mock adapter",
  getAllowanceTarget() {
    return null;
  },
  buildDepositCall() {
    return {
      ok: false,
      reason: "The MasterVault write adapter is still pending final contract wiring."
    };
  },
  buildWithdrawCall() {
    return {
      ok: false,
      reason: "The MasterVault write adapter is still pending final contract wiring."
    };
  }
};

export function getMasterVaultAdapter(config: WalletFeatureConfig): MasterVaultAdapter {
  if (config.masterVault.adapter === "eip4626") return eip4626Adapter;
  if (config.masterVault.adapter === "mock") return mockAdapter;
  return legacyTokenAmountAdapter;
}
