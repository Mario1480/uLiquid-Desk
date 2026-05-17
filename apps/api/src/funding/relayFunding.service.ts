import { isAddress, parseUnits } from "viem";
import { resolveFundingReadConfig, type FundingReadConfig } from "./config.js";
import type {
  RelayFundingAmount,
  RelayFundingQuote,
  RelayFundingQuoteLeg,
  RelayFundingStatus,
  RelayFundingStep,
  RelayFundingTransactionRequest
} from "./types.js";

const DEFAULT_RELAY_API_URL = "https://api.relay.link";
const RELAY_NATIVE_ADDRESS = "0x0000000000000000000000000000000000000000";
const HYPE_TOPUP_MAX_USDC = 1_000;
const FUNDING_MAX_USDC = 1_000_000;
const MIN_USDC = 0.01;

export type RelayFundingService = {
  getQuote(input: {
    user: string;
    usdcAmount: string;
    direction?: "arbitrum_to_hyperevm" | "hyperevm_to_arbitrum";
    includeHypeTopup?: boolean;
    hypeTopupUsdcAmount?: string;
  }): Promise<RelayFundingQuote>;
  getStatus(input: { requestId: string }): Promise<RelayFundingStatus>;
};

type RelayFundingServiceDeps = {
  fetch?: typeof fetch;
  config?: FundingReadConfig;
  relayApiUrl?: string;
};

function normalizeRelayApiUrl(value: string | null | undefined): string {
  const raw = String(value ?? "").trim() || DEFAULT_RELAY_API_URL;
  try {
    return new URL(raw).toString().replace(/\/$/, "");
  } catch {
    return DEFAULT_RELAY_API_URL;
  }
}

function asObject(value: unknown): Record<string, any> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, any>
    : {};
}

function decimalAmount(value: string, decimals: number, max: number): { formatted: string; raw: string } {
  const formatted = String(value ?? "").trim().replace(",", ".");
  const parsed = Number(formatted);
  if (!Number.isFinite(parsed) || parsed < MIN_USDC || parsed > max) {
    throw new Error("relay_invalid_amount");
  }
  return {
    formatted,
    raw: parseUnits(formatted, decimals).toString()
  };
}

function isRelayRequestId(value: string): boolean {
  return /^0x[0-9a-fA-F]{64}$/.test(value);
}

function requestIdFromCheck(value: unknown): string | null {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  if (isRelayRequestId(raw)) return raw;
  try {
    const url = raw.startsWith("http")
      ? new URL(raw)
      : new URL(raw, DEFAULT_RELAY_API_URL);
    const requestId = url.searchParams.get("requestId");
    return requestId && isRelayRequestId(requestId) ? requestId : null;
  } catch {
    return null;
  }
}

function validateRequestId(value: unknown): string {
  const raw = String(value ?? "").trim();
  if (!isRelayRequestId(raw)) throw new Error("relay_invalid_request_id");
  return raw;
}

function requestIdFromRelayPayload(value: unknown, depth = 0): string | null {
  const direct = requestIdFromCheck(value);
  if (direct) return direct;
  if (depth > 3 || !value || typeof value !== "object" || Array.isArray(value)) return null;

  const record = value as Record<string, unknown>;
  for (const key of ["requestId", "check", "statusUrl", "statusURL", "statusPath", "href", "url"]) {
    const requestId = requestIdFromCheck(record[key]);
    if (requestId) return requestId;
  }

  for (const nested of Object.values(record)) {
    const requestId = requestIdFromRelayPayload(nested, depth + 1);
    if (requestId) return requestId;
  }
  return null;
}

function normalizeAmount(input: {
  raw: unknown;
  formatted: unknown;
  currency: Record<string, any>;
  fallbackSymbol: RelayFundingAmount["symbol"];
  fallbackDecimals: number;
  fallbackChainId: number;
}): RelayFundingAmount {
  const decimals = Number(input.currency.decimals ?? input.fallbackDecimals);
  return {
    raw: String(input.raw ?? "0"),
    formatted: String(input.formatted ?? "0"),
    symbol: String(input.currency.symbol ?? input.fallbackSymbol) as RelayFundingAmount["symbol"],
    decimals: Number.isFinite(decimals) ? decimals : input.fallbackDecimals,
    chainId: Number(input.currency.chainId ?? input.fallbackChainId)
  };
}

function normalizeTxRequest(value: unknown): RelayFundingTransactionRequest | null {
  const data = asObject(value);
  const to = String(data.to ?? "").trim();
  const calldata = String(data.data ?? "0x").trim();
  if (!isAddress(to) || !/^0x[0-9a-fA-F]*$/.test(calldata)) return null;
  const chainId = Number(data.chainId);
  if (!Number.isFinite(chainId) || chainId <= 0) return null;
  return {
    chainId: Math.trunc(chainId),
    to: to as `0x${string}`,
    data: calldata as `0x${string}`,
    value: String(data.value ?? "0")
  };
}

function normalizeSteps(rawSteps: unknown): RelayFundingStep[] {
  const steps = Array.isArray(rawSteps) ? rawSteps : [];
  return steps
    .map((stepRaw): RelayFundingStep | null => {
      const step = asObject(stepRaw);
      const itemsRaw = Array.isArray(step.items) ? step.items : [];
      const items = itemsRaw
        .map((itemRaw: unknown) => {
          const item = asObject(itemRaw);
          const tx = normalizeTxRequest(item.data);
          if (!tx) return null;
          return {
            status: String(item.status ?? "incomplete"),
            tx
          };
        })
        .filter((item): item is { status: string; tx: RelayFundingTransactionRequest } => Boolean(item));
      if (items.length === 0) return null;
      const stepRequestId = requestIdFromRelayPayload(step);
      return {
        id: String(step.id ?? "transaction"),
        kind: String(step.kind ?? "transaction"),
        requestId: stepRequestId ?? itemsRaw.map((item) => requestIdFromRelayPayload(item)).find(Boolean) ?? null,
        items
      };
    })
    .filter((step): step is RelayFundingStep => Boolean(step));
}

function normalizeLeg(input: {
  legId: RelayFundingQuoteLeg["legId"];
  asset: RelayFundingQuoteLeg["asset"];
  raw: Record<string, any>;
  originChainId: number;
  destinationChainId: number;
}): RelayFundingQuoteLeg {
  const details = asObject(input.raw.details);
  const fees = asObject(input.raw.fees);
  const currencyIn = asObject(details.currencyIn);
  const currencyOut = asObject(details.currencyOut);
  const relayer = asObject(fees.relayer);
  const gas = asObject(fees.gas);
  const steps = normalizeSteps(input.raw.steps);
  const requestId = steps.map((step) => step.requestId).find(Boolean) ?? null;

  return {
    legId: input.legId,
    asset: input.asset,
    sourceAmount: normalizeAmount({
      raw: currencyIn.amount,
      formatted: currencyIn.amountFormatted,
      currency: asObject(currencyIn.currency),
      fallbackSymbol: "USDC",
      fallbackDecimals: 6,
      fallbackChainId: input.originChainId
    }),
    destinationAmount: normalizeAmount({
      raw: currencyOut.amount,
      formatted: currencyOut.amountFormatted,
      currency: asObject(currencyOut.currency),
      fallbackSymbol: input.asset,
      fallbackDecimals: input.asset === "USDC" ? 6 : 18,
      fallbackChainId: input.destinationChainId
    }),
    feeAmount: relayer.amount
      ? normalizeAmount({
          raw: relayer.amount,
          formatted: relayer.amountFormatted,
          currency: asObject(relayer.currency),
          fallbackSymbol: "USDC",
          fallbackDecimals: 6,
          fallbackChainId: input.originChainId
        })
      : null,
    gasAmount: gas.amount
      ? normalizeAmount({
          raw: gas.amount,
          formatted: gas.amountFormatted,
          currency: asObject(gas.currency),
          fallbackSymbol: "ETH",
          fallbackDecimals: 18,
          fallbackChainId: input.originChainId
        })
      : null,
    timeEstimateSeconds: Number.isFinite(Number(details.timeEstimate)) ? Number(details.timeEstimate) : null,
    requestId,
    steps
  };
}

function normalizeStatus(value: unknown): RelayFundingStatus["status"] {
  const raw = String(value ?? "").trim().toLowerCase();
  if (["success", "complete", "completed", "confirmed"].includes(raw)) return "success";
  if (["failure", "failed", "refund", "refunded", "expired"].includes(raw)) return "failed";
  if (["waiting", "pending", "incomplete", "submitted"].includes(raw)) return "pending";
  return "unknown";
}

function txHashFromStatus(raw: Record<string, any>): string | null {
  const candidates = [
    raw.txHash,
    raw.transactionHash,
    raw.destinationTxHash,
    raw.details?.txHash,
    raw.details?.transactionHash,
    raw.details?.destinationTxHash
  ];
  const match = candidates.map((item) => String(item ?? "").trim()).find((item) => /^0x[0-9a-fA-F]{64}$/.test(item));
  return match ?? null;
}

export function createRelayFundingService(deps: RelayFundingServiceDeps = {}): RelayFundingService {
  const config = deps.config ?? resolveFundingReadConfig();
  const relayApiUrl = normalizeRelayApiUrl(deps.relayApiUrl ?? process.env.RELAY_API_URL);
  const fetchImpl = deps.fetch ?? globalThis.fetch;

  async function postRelayQuote(input: {
    user: string;
    originChainId: number;
    destinationChainId: number;
    originCurrency: string;
    destinationCurrency: string;
    amountRaw: string;
  }): Promise<Record<string, any>> {
    const response = await fetchImpl(`${relayApiUrl}/quote/v2`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        user: input.user,
        recipient: input.user,
        originChainId: input.originChainId,
        destinationChainId: input.destinationChainId,
        originCurrency: input.originCurrency,
        destinationCurrency: input.destinationCurrency,
        amount: input.amountRaw,
        tradeType: "EXACT_INPUT"
      })
    });
    const payload = asObject(await response.json().catch(() => ({})));
    if (!response.ok || payload.errors || payload.error) {
      throw new Error(String(payload.message ?? payload.error ?? "relay_quote_failed"));
    }
    return payload;
  }

  return {
    async getQuote(input) {
      if (!isAddress(input.user)) throw new Error("relay_invalid_user");
      if (!config.arbitrum.usdcAddress || !config.hyperEvm.usdcAddress) {
        throw new Error("relay_token_config_missing");
      }
      const user = input.user.trim().toLowerCase();
      const direction = input.direction ?? "arbitrum_to_hyperevm";
      if (direction !== "arbitrum_to_hyperevm" && direction !== "hyperevm_to_arbitrum") {
        throw new Error("relay_invalid_direction");
      }
      if (direction === "hyperevm_to_arbitrum" && input.includeHypeTopup) {
        throw new Error("relay_hype_topup_not_supported");
      }
      const originUsdcDecimals = direction === "hyperevm_to_arbitrum"
        ? config.hyperEvm.usdcDecimals
        : config.arbitrum.usdcDecimals;
      const originChainId = direction === "hyperevm_to_arbitrum" ? config.hyperEvm.chainId : config.arbitrum.chainId;
      const destinationChainId = direction === "hyperevm_to_arbitrum" ? config.arbitrum.chainId : config.hyperEvm.chainId;
      const originUsdcAddress = direction === "hyperevm_to_arbitrum" ? config.hyperEvm.usdcAddress : config.arbitrum.usdcAddress;
      const destinationUsdcAddress = direction === "hyperevm_to_arbitrum" ? config.arbitrum.usdcAddress : config.hyperEvm.usdcAddress;
      const usdcAmount = decimalAmount(input.usdcAmount, originUsdcDecimals, FUNDING_MAX_USDC);
      const includeHypeTopup = Boolean(input.includeHypeTopup);
      const hypeAmount = includeHypeTopup
        ? decimalAmount(input.hypeTopupUsdcAmount ?? "5", config.arbitrum.usdcDecimals, HYPE_TOPUP_MAX_USDC)
        : null;

      const [usdcRaw, hypeRaw] = await Promise.all([
        postRelayQuote({
          user,
          originChainId,
          destinationChainId,
          originCurrency: originUsdcAddress,
          destinationCurrency: destinationUsdcAddress,
          amountRaw: usdcAmount.raw
        }),
        hypeAmount
          ? postRelayQuote({
              user,
              originChainId: config.arbitrum.chainId,
              destinationChainId: config.hyperEvm.chainId,
              originCurrency: config.arbitrum.usdcAddress,
              destinationCurrency: RELAY_NATIVE_ADDRESS,
              amountRaw: hypeAmount.raw
            })
          : Promise.resolve(null)
      ]);

      return {
        provider: "relay",
        direction,
        originChainId,
        destinationChainId,
        usdc: normalizeLeg({
          legId: direction === "hyperevm_to_arbitrum" ? "usdc_withdrawal" : "usdc",
          asset: "USDC",
          raw: usdcRaw,
          originChainId,
          destinationChainId
        }),
        hypeTopup: hypeRaw
          ? normalizeLeg({
              legId: "hype_topup",
              asset: "HYPE",
              raw: hypeRaw,
              originChainId: config.arbitrum.chainId,
              destinationChainId: config.hyperEvm.chainId
            })
          : null,
        createdAt: new Date().toISOString()
      };
    },
    async getStatus(input) {
      const requestId = validateRequestId(input.requestId);
      const response = await fetchImpl(`${relayApiUrl}/intents/status/v3?requestId=${encodeURIComponent(requestId)}`, {
        method: "GET",
        headers: { "accept": "application/json" }
      });
      const payload = asObject(await response.json().catch(() => ({})));
      if (!response.ok || payload.error) {
        throw new Error(String(payload.message ?? payload.error ?? "relay_status_failed"));
      }
      const rawStatus = String(payload.status ?? "").trim() || null;
      return {
        provider: "relay",
        requestId,
        status: normalizeStatus(rawStatus),
        rawStatus,
        txHash: txHashFromStatus(payload),
        updatedAt: new Date().toISOString()
      };
    }
  };
}
