export const ULIQ_PUBLIC_PRESALE_CHAIN_IDS = [42161, 421614] as const;
export type UliqPublicPresaleChainId = (typeof ULIQ_PUBLIC_PRESALE_CHAIN_IDS)[number];
export type UliqPublicPresaleRoundId = "round-1" | "round-2";

export type UliqPublicPresaleRoundConfig = {
  id: UliqPublicPresaleRoundId;
  number: 1 | 2;
  contractAddress: `0x${string}`;
  vestingAddress: `0x${string}`;
  paymentCustodyAddress: `0x${string}`;
  expected: {
    allocationUliqRaw: bigint;
    priceUsdcRawPerUliq: bigint;
    hardCapUsdcRaw: bigint;
    minPurchaseUsdcRaw: bigint;
    maxPurchaseUsdcRaw: bigint;
    initialUnlockBps: bigint;
    cliffSeconds: bigint;
    linearVestingDurationSeconds: bigint;
  };
};

export type UliqPublicPresaleConfig = {
  enabled: boolean;
  purchasesEnabled: boolean;
  chainId: UliqPublicPresaleChainId;
  startBlock: bigint;
  primaryRpcUrl: string;
  secondaryRpcUrl: string;
  tokenAddress: `0x${string}`;
  usdcAddress: `0x${string}`;
  globalListingAddress: `0x${string}`;
  explorerUrl: string;
  rounds: readonly [UliqPublicPresaleRoundConfig, UliqPublicPresaleRoundConfig];
  terms: {
    version: string | null;
    textHash: string | null;
    url: string;
    ready: boolean;
  };
};

const EXPECTED_ROUNDS = [
  {
    id: "round-1" as const,
    number: 1 as const,
    allocationUliqRaw: 50_000_000n * 10n ** 18n,
    priceUsdcRawPerUliq: 2_000n,
    hardCapUsdcRaw: 100_000n * 10n ** 6n,
    minPurchaseUsdcRaw: 500n * 10n ** 6n,
    maxPurchaseUsdcRaw: 10_000n * 10n ** 6n,
    initialUnlockBps: 500n,
    cliffSeconds: 90n * 24n * 60n * 60n,
    linearVestingDurationSeconds: 548n * 24n * 60n * 60n
  },
  {
    id: "round-2" as const,
    number: 2 as const,
    allocationUliqRaw: 100_000_000n * 10n ** 18n,
    priceUsdcRawPerUliq: 3_500n,
    hardCapUsdcRaw: 350_000n * 10n ** 6n,
    minPurchaseUsdcRaw: 100n * 10n ** 6n,
    maxPurchaseUsdcRaw: 5_000n * 10n ** 6n,
    initialUnlockBps: 2_500n,
    cliffSeconds: 0n,
    linearVestingDurationSeconds: 274n * 24n * 60n * 60n
  }
] as const;

function enabled(value: string | undefined): boolean {
  return ["1", "true", "yes", "on"].includes(String(value ?? "").trim().toLowerCase());
}

function address(value: string | undefined, name: string): `0x${string}` {
  const normalized = String(value ?? "").trim();
  if (!/^0x[0-9a-fA-F]{40}$/.test(normalized) || /^0x0{40}$/i.test(normalized)) {
    throw new Error(`uliq_public_presale_invalid_${name}`);
  }
  return normalized.toLowerCase() as `0x${string}`;
}

function rpcUrl(value: string | undefined, name: string): string {
  const normalized = String(value ?? "").trim();
  try {
    const parsed = new URL(normalized);
    if (!["http:", "https:"].includes(parsed.protocol)) throw new Error("invalid_protocol");
    return parsed.toString();
  } catch {
    throw new Error(`uliq_public_presale_invalid_${name}`);
  }
}

function chainId(value: string | undefined): UliqPublicPresaleChainId {
  const parsed = Number(String(value ?? "").trim());
  if (!ULIQ_PUBLIC_PRESALE_CHAIN_IDS.includes(parsed as UliqPublicPresaleChainId)) {
    throw new Error("uliq_public_presale_invalid_chain_id");
  }
  return parsed as UliqPublicPresaleChainId;
}

function startBlock(value: string | undefined): bigint {
  const normalized = String(value ?? "").trim();
  if (!/^[1-9]\d*$/.test(normalized)) throw new Error("uliq_public_presale_invalid_start_block");
  return BigInt(normalized);
}

export function getUliqPublicPresaleFlags(env: NodeJS.ProcessEnv = process.env) {
  const enabledFlag = enabled(env.ULIQ_PUBLIC_PRESALE_ENABLED);
  const purchasesEnabled = enabled(env.ULIQ_PUBLIC_PRESALE_PURCHASES_ENABLED);
  if (purchasesEnabled && !enabledFlag) throw new Error("uliq_public_presale_parent_disabled");
  return { enabled: enabledFlag, purchasesEnabled };
}

export function getUliqPublicPresaleConfig(env: NodeJS.ProcessEnv = process.env): UliqPublicPresaleConfig {
  const flags = getUliqPublicPresaleFlags(env);
  if (!flags.enabled) throw new Error("uliq_public_presale_disabled");

  const configuredChainId = chainId(env.ULIQ_PUBLIC_PRESALE_CHAIN_ID);
  const primaryRpcUrl = rpcUrl(env.ULIQ_PUBLIC_PRESALE_RPC_PRIMARY_URL, "primary_rpc");
  const secondaryRpcUrl = rpcUrl(env.ULIQ_PUBLIC_PRESALE_RPC_SECONDARY_URL, "secondary_rpc");
  if (primaryRpcUrl === secondaryRpcUrl) throw new Error("uliq_public_presale_distinct_rpc_required");

  const termsVersion = String(env.ULIQ_PUBLIC_PRESALE_TERMS_VERSION ?? "").trim() || null;
  const rawTermsHash = String(env.ULIQ_PUBLIC_PRESALE_TERMS_HASH ?? "").trim().toLowerCase();
  const termsHash = /^([0-9a-f]{64})$/.test(rawTermsHash) ? rawTermsHash : null;
  const termsReady = Boolean(termsVersion && termsHash);

  if (flags.purchasesEnabled && !termsReady) throw new Error("uliq_public_presale_terms_not_ready");
  if (
    flags.purchasesEnabled
    && configuredChainId === 42161
    && (
      !enabled(env.ULIQ_PUBLIC_PRESALE_MAINNET_APPROVED)
      || !enabled(env.ULIQ_PUBLIC_PRESALE_LEGAL_APPROVED)
    )
  ) {
    throw new Error("uliq_public_presale_mainnet_activation_forbidden");
  }

  const tokenAddress = address(env.ULIQ_PUBLIC_PRESALE_TOKEN_ADDRESS, "token_address");
  const usdcAddress = address(env.ULIQ_PUBLIC_PRESALE_USDC_ADDRESS, "usdc_address");
  const globalListingAddress = address(env.ULIQ_PUBLIC_PRESALE_GLOBAL_LISTING_ADDRESS, "global_listing_address");
  const roundAddresses = [
    {
      contractAddress: address(env.ULIQ_PUBLIC_PRESALE_ROUND_1_ADDRESS, "round_1_address"),
      vestingAddress: address(env.ULIQ_PUBLIC_PRESALE_ROUND_1_VESTING_ADDRESS, "round_1_vesting_address"),
      paymentCustodyAddress: address(env.ULIQ_PUBLIC_PRESALE_ROUND_1_PAYMENT_CUSTODY_ADDRESS, "round_1_payment_custody_address")
    },
    {
      contractAddress: address(env.ULIQ_PUBLIC_PRESALE_ROUND_2_ADDRESS, "round_2_address"),
      vestingAddress: address(env.ULIQ_PUBLIC_PRESALE_ROUND_2_VESTING_ADDRESS, "round_2_vesting_address"),
      paymentCustodyAddress: address(env.ULIQ_PUBLIC_PRESALE_ROUND_2_PAYMENT_CUSTODY_ADDRESS, "round_2_payment_custody_address")
    }
  ] as const;
  const uniqueAddresses = [
    tokenAddress,
    usdcAddress,
    globalListingAddress,
    ...roundAddresses.flatMap((round) => [round.contractAddress, round.vestingAddress, round.paymentCustodyAddress])
  ].map((entry) => entry.toLowerCase());
  if (new Set(uniqueAddresses).size !== uniqueAddresses.length) {
    throw new Error("uliq_public_presale_duplicate_contract_address");
  }
  const rounds = EXPECTED_ROUNDS.map((expected, index): UliqPublicPresaleRoundConfig => ({
    id: expected.id,
    number: expected.number,
    ...roundAddresses[index],
    expected: {
      allocationUliqRaw: expected.allocationUliqRaw,
      priceUsdcRawPerUliq: expected.priceUsdcRawPerUliq,
      hardCapUsdcRaw: expected.hardCapUsdcRaw,
      minPurchaseUsdcRaw: expected.minPurchaseUsdcRaw,
      maxPurchaseUsdcRaw: expected.maxPurchaseUsdcRaw,
      initialUnlockBps: expected.initialUnlockBps,
      cliffSeconds: expected.cliffSeconds,
      linearVestingDurationSeconds: expected.linearVestingDurationSeconds
    }
  }));

  return {
    ...flags,
    chainId: configuredChainId,
    startBlock: startBlock(env.ULIQ_PUBLIC_PRESALE_START_BLOCK),
    primaryRpcUrl,
    secondaryRpcUrl,
    tokenAddress,
    usdcAddress,
    globalListingAddress,
    explorerUrl: String(env.ULIQ_PUBLIC_PRESALE_EXPLORER_URL ?? "").trim(),
    rounds: [rounds[0], rounds[1]],
    terms: {
      version: termsVersion,
      textHash: termsHash,
      url: String(env.ULIQ_PUBLIC_PRESALE_TERMS_URL ?? "/presale/terms").trim() || "/presale/terms",
      ready: termsReady
    }
  };
}
