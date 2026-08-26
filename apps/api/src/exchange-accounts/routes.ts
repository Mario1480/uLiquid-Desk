import crypto from "crypto";
import express from "express";
import { z } from "zod";
import type { CapabilityKey, PlanCapabilities, PlanTier } from "@mm/core";
import { getUserFromLocals, requireAuth } from "../auth.js";
import { type syncExchangeAccount, ExchangeSyncError } from "../exchange-sync.js";
import {
  createPerpExecutionAdapter,
  type PerpExecutionAdapter,
  type TradingAccount
} from "../trading.js";
import {
  createManualPerpMarketDataClient,
  createManualSpotClient,
  resolveManualPerpSupport,
  resolveManualSpotSupport
} from "../manual-trading/support.js";
import { isValidPaperLinkedMarketDataExchange } from "../paper/policy.js";
import {
  deriveHyperliquidCredentialExpiryState,
  isHyperliquidExchange
} from "./hyperliquidCredentialExpiry.js";
import { readRouteParam } from "../routeParams.js";

type ExchangeAccountSecretsLike = {
  id: string;
  userId: string;
  exchange: string;
  apiKeyEnc: string;
  apiSecretEnc: string;
  passphraseEnc: string | null;
};

function normalizeAddress(value: string | null | undefined): string | null {
  const normalized = String(value ?? "").trim();
  return /^0x[a-fA-F0-9]{40}$/.test(normalized) ? normalized : null;
}

function validateExchangeCredentials(
  value: {
    exchange: string;
    apiKey?: string;
    apiSecret?: string;
    passphrase?: string;
    marketDataExchangeAccountId?: string;
  },
  ctx: z.RefinementCtx
) {
  const exchange = value.exchange.toLowerCase();
  if (exchange === "bitget") {
    if (!value.apiKey) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["apiKey"], message: "apiKey is required for bitget" });
    }
    if (!value.apiSecret) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["apiSecret"], message: "apiSecret is required for bitget" });
    }
  }
  if (exchange === "mexc") {
    if (!value.apiKey) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["apiKey"], message: "apiKey is required for mexc" });
    }
    if (!value.apiSecret) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["apiSecret"], message: "apiSecret is required for mexc" });
    }
  }
  if (exchange !== "paper" && !value.apiKey) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["apiKey"], message: "apiKey is required" });
  }
  if (exchange !== "paper" && !value.apiSecret) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["apiSecret"], message: "apiSecret is required" });
  }
  if (exchange === "bitget" && !value.passphrase) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["passphrase"], message: "passphrase is required for bitget" });
  }
  if (exchange === "hyperliquid" && value.apiKey && !/^0x[a-fA-F0-9]{40}$/.test(value.apiKey)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["apiKey"],
      message: "apiKey must be a wallet address (0x + 40 hex) for hyperliquid"
    });
  }
  if (
    exchange === "hyperliquid" &&
    value.apiSecret &&
    !/^(0x)?[a-fA-F0-9]{64}$/.test(value.apiSecret)
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["apiSecret"],
      message: "apiSecret must be a private key (64 hex, optional 0x) for hyperliquid"
    });
  }
  if (exchange === "paper" && !value.marketDataExchangeAccountId) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["marketDataExchangeAccountId"],
      message: "marketDataExchangeAccountId is required for paper"
    });
  }
}

const exchangeCreateSchema = z.object({
  exchange: z.string().trim().min(1),
  label: z.string().trim().min(1),
  apiKey: z.string().trim().optional(),
  apiSecret: z.string().trim().optional(),
  passphrase: z.string().trim().optional(),
  marketDataExchangeAccountId: z.string().trim().optional()
}).superRefine(validateExchangeCredentials);

const exchangeUpdateSchema = z.object({
  label: z.string().trim().min(1),
  apiKey: z.string().trim().optional(),
  apiSecret: z.string().trim().optional(),
  passphrase: z.string().trim().optional(),
  clearPassphrase: z.boolean().optional(),
  marketDataExchangeAccountId: z.string().trim().optional()
});

const exchangeAccountAssetsQuerySchema = z.object({
  exchangeAccountId: z.string().trim().min(1).optional(),
  includeZero: z.preprocess((value) => {
    if (typeof value === "string") {
      return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
    }
    return value;
  }, z.boolean().default(false))
});

type AccountAssetBalance = {
  asset: string;
  available: number | null;
  locked: number | null;
  total: number | null;
  approxUsd: number | null;
  quoteSymbol: string | null;
};

type AccountMarketStatus = "ok" | "empty" | "unsupported" | "error";

type AccountPerpOverview = {
  status: AccountMarketStatus;
  updatedAt: string | null;
  error: { code: string; message: string } | null;
  marginAsset: "USDT" | "USDC";
  equityUsd: number | null;
  availableMarginUsd: number | null;
  marginMode: string | null;
};

function toFiniteNumber(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function roundAssetNumber(value: number | null): number | null {
  if (value === null || !Number.isFinite(value)) return null;
  return Number(value.toFixed(8));
}

function roundUsdNumber(value: number | null): number | null {
  if (value === null || !Number.isFinite(value)) return null;
  return Number(value.toFixed(6));
}

function isStablecoin(asset: string): boolean {
  return asset === "USDT" || asset === "USDC";
}

function resolveQuoteAsset(exchange: string): "USDT" | "USDC" {
  return exchange.trim().toLowerCase() === "hyperliquid" ? "USDC" : "USDT";
}

function createEmptyPerpOverview(marginAsset: "USDT" | "USDC"): AccountPerpOverview {
  return {
    status: "unsupported",
    updatedAt: null,
    error: null,
    marginAsset,
    equityUsd: null,
    availableMarginUsd: null,
    marginMode: null
  };
}

function normalizeMarginMode(value: unknown): string | null {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (!normalized) return null;
  if (normalized.includes("isolated")) return "isolated";
  if (normalized.includes("cross")) return "cross";
  return normalized;
}

function resolvePerpStatus(equityUsd: number | null, availableMarginUsd: number | null): AccountMarketStatus {
  if (equityUsd === null && availableMarginUsd === null) return "empty";
  if ((equityUsd ?? 0) <= 0 && (availableMarginUsd ?? 0) <= 0) return "empty";
  return "ok";
}

function normalizeSpotBalanceRow(row: {
  coin?: string;
  asset?: string;
  available?: string | number;
  frozen?: string | number;
  locked?: string | number;
  lock?: string | number;
}): Omit<AccountAssetBalance, "approxUsd" | "quoteSymbol"> | null {
  const asset = String(row.coin ?? row.asset ?? "").trim().toUpperCase();
  if (!asset) return null;
  const available = toFiniteNumber(row.available);
  const locked =
    toFiniteNumber(row.frozen) ??
    toFiniteNumber(row.locked) ??
    toFiniteNumber(row.lock);
  const total =
    available === null && locked === null
      ? null
      : roundAssetNumber((available ?? 0) + (locked ?? 0));
  return {
    asset,
    available: roundAssetNumber(available),
    locked: roundAssetNumber(locked),
    total
  };
}

function shouldIncludeAsset(asset: Pick<AccountAssetBalance, "available" | "locked" | "total">, includeZero: boolean): boolean {
  if (includeZero) return true;
  const total = asset.total ?? ((asset.available ?? 0) + (asset.locked ?? 0));
  return Number.isFinite(total) && total > 0;
}

function sortAccountAssets(a: AccountAssetBalance, b: AccountAssetBalance): number {
  if (a.approxUsd !== null && b.approxUsd !== null && a.approxUsd !== b.approxUsd) {
    return b.approxUsd - a.approxUsd;
  }
  if (a.approxUsd !== null && b.approxUsd === null) return -1;
  if (a.approxUsd === null && b.approxUsd !== null) return 1;
  const aStable = isStablecoin(a.asset);
  const bStable = isStablecoin(b.asset);
  if (aStable !== bStable) return aStable ? -1 : 1;
  return a.asset.localeCompare(b.asset);
}

function routeErrorPayload(error: unknown): { code: string; message: string } {
  const codeRaw =
    (error as { code?: unknown })?.code ??
    (error as { payload?: { code?: unknown } })?.payload?.code;
  const messageRaw =
    error instanceof Error
      ? error.message
      : (error as { message?: unknown })?.message ?? String(error ?? "");
  return {
    code: String(codeRaw ?? "account_assets_failed"),
    message: String(messageRaw || "Account assets could not be loaded.")
  };
}

export type RegisterExchangeAccountRoutesDeps = {
  db: any;
  decryptSecret(value: string): string;
  encryptSecret(value: string): string;
  maskSecret(value: string): string;
  normalizeExchangeValue(value: string): string;
  isMexcEnabledAtRuntime(): boolean;
  isBinanceEnabledAtRuntime(): boolean;
  isBingxEnabledAtRuntime(): boolean;
  getAllowedExchangeValues(): Promise<string[]>;
  createExchangeAccountWithAdmission<T>(params: {
    userId: string;
    exchange: string;
    create: (tx: any) => Promise<T>;
  }): Promise<
    | { outcome: "allowed"; value: T; limit: number | null; usage: number; counted: boolean }
    | { outcome: "denied"; reason: "max_exchange_accounts_exceeded"; limit: number; usage: number; counted: true }
  >;
  listPaperMarketDataAccountIds(exchangeAccountIds: string[]): Promise<Record<string, string | null>>;
  setPaperMarketDataAccountId(exchangeAccountId: string, marketDataExchangeAccountId: string): Promise<void>;
  clearPaperMarketDataAccountId(exchangeAccountId: string): Promise<void>;
  clearPaperState(exchangeAccountId: string): Promise<void>;
  resolveMarketDataTradingAccount(userId: string, exchangeAccountId?: string): Promise<{
    selectedAccount: TradingAccount;
    marketDataAccount: TradingAccount;
  }>;
  getPaperAccountState(
    account: TradingAccount,
    reader: ReturnType<typeof createManualPerpMarketDataClient>
  ): Promise<{ equity: number | null; availableMargin: number | null; marginMode?: string | null }>;
  getPaperSpotAccountState(
    account: TradingAccount,
    client: ReturnType<typeof createManualSpotClient>
  ): Promise<{ equity: number | null; availableMargin: number | null }>;
  createManualSpotClient?(
    account: TradingAccount,
    endpoint: string
  ): ReturnType<typeof createManualSpotClient>;
  createManualPerpMarketDataClient?(
    account: TradingAccount,
    endpoint: string
  ): ReturnType<typeof createManualPerpMarketDataClient>;
  createPerpExecutionAdapter?(account: TradingAccount): PerpExecutionAdapter;
  persistExchangeSyncSuccess(
    userId: string,
    accountId: string,
    synced: Awaited<ReturnType<typeof syncExchangeAccount>>
  ): Promise<void>;
  persistExchangeSyncFailure(accountId: string, errorMessage: string): Promise<void>;
  executeExchangeSync(account: ExchangeAccountSecretsLike): Promise<Awaited<ReturnType<typeof syncExchangeAccount>>>;
  ExchangeSyncError: typeof ExchangeSyncError;
  resolvePlanCapabilitiesForUserId(input: {
    userId: string;
  }): Promise<{ plan: PlanTier; capabilities: PlanCapabilities }>;
  isCapabilityAllowed(capabilities: PlanCapabilities, capability: CapabilityKey): boolean;
  sendCapabilityDenied(
    res: express.Response,
    params: {
      capability: CapabilityKey;
      currentPlan: PlanTier;
      legacyCode?: string;
    }
  ): express.Response;
  sendManualTradingError(res: express.Response, error: unknown): express.Response;
};

export function registerExchangeAccountRoutes(
  app: express.Express,
  deps: RegisterExchangeAccountRoutesDeps
) {
  app.get("/exchange-accounts/assets", requireAuth, async (req, res) => {
    const user = getUserFromLocals(res);
    const parsed = exchangeAccountAssetsQuerySchema.safeParse(req.query ?? {});
    if (!parsed.success) {
      return res.status(400).json({ error: "invalid_query", details: parsed.error.flatten() });
    }

    const rows = await deps.db.exchangeAccount.findMany({
      where: {
        userId: user.id,
        ...(parsed.data.exchangeAccountId ? { id: parsed.data.exchangeAccountId } : {})
      },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        exchange: true,
        label: true
      }
    });

    if (parsed.data.exchangeAccountId && rows.length === 0) {
      return res.status(404).json({ error: "exchange_account_not_found" });
    }

    const spotClientFactory = deps.createManualSpotClient ?? createManualSpotClient;
    const perpMarketDataClientFactory = deps.createManualPerpMarketDataClient ?? createManualPerpMarketDataClient;
    const perpExecutionAdapterFactory = deps.createPerpExecutionAdapter ?? createPerpExecutionAdapter;
    const updatedAt = new Date().toISOString();
    let partialErrors = 0;

    const accounts = await Promise.all(rows.map(async (row: any) => {
      const baseExchange = String(row.exchange ?? "");
      const baseQuoteAsset = resolveQuoteAsset(baseExchange);
      const base = {
        exchangeAccountId: String(row.id),
        exchange: baseExchange,
        label: String(row.label ?? ""),
        marketDataExchange: baseExchange,
        updatedAt: null as string | null,
        error: null as { code: string; message: string } | null,
        quoteAsset: baseQuoteAsset,
        totals: { assets: 0, approxUsd: null as number | null },
        assets: [] as AccountAssetBalance[],
        perp: createEmptyPerpOverview(baseQuoteAsset)
      };

      let resolved: { selectedAccount: TradingAccount; marketDataAccount: TradingAccount };
      try {
        resolved = await deps.resolveMarketDataTradingAccount(user.id, String(row.id));
      } catch (error) {
        const payload = routeErrorPayload(error);
        partialErrors += 1;
        return {
          ...base,
          status: "error" as const,
          error: payload,
          perp: {
            ...base.perp,
            status: "error" as const,
            error: payload
          }
        };
      }

      const selectedExchange = deps.normalizeExchangeValue(String(resolved.selectedAccount.exchange ?? ""));
      const marketDataExchange = deps.normalizeExchangeValue(String(resolved.marketDataAccount.exchange ?? ""));
      const quoteAsset = resolveQuoteAsset(marketDataExchange);

      let status: AccountMarketStatus = "unsupported";
      let spotUpdatedAt: string | null = null;
      let spotError: { code: string; message: string } | null = null;
      let totals = { assets: 0, approxUsd: null as number | null };
      let assets: AccountAssetBalance[] = [];

      try {
        const supportsSpot = resolveManualSpotSupport({
          exchange: selectedExchange,
          marketDataExchange
        });

        if (supportsSpot) {
          const client = spotClientFactory(resolved.marketDataAccount, "/exchange-accounts/assets");
          const balanceRows = await client.getBalances();
          const normalized = balanceRows
            .map((balanceRow) => normalizeSpotBalanceRow(balanceRow))
            .filter((asset): asset is Omit<AccountAssetBalance, "approxUsd" | "quoteSymbol"> => Boolean(asset))
            .filter((asset) => shouldIncludeAsset(asset, parsed.data.includeZero));

          const pricedAssets = await Promise.all(normalized.map(async (asset) => {
            const total = asset.total;
            if (total === null) {
              return {
                ...asset,
                approxUsd: null,
                quoteSymbol: null
              };
            }
            if (isStablecoin(asset.asset)) {
              return {
                ...asset,
                approxUsd: roundUsdNumber(total),
                quoteSymbol: asset.asset
              };
            }

            const quoteSymbol = `${asset.asset}${quoteAsset}`;
            try {
              const lastPrice = await client.getLastPrice(quoteSymbol);
              const price = toFiniteNumber(lastPrice);
              return {
                ...asset,
                approxUsd: price === null ? null : roundUsdNumber(total * price),
                quoteSymbol
              };
            } catch {
              return {
                ...asset,
                approxUsd: null,
                quoteSymbol
              };
            }
          }));

          pricedAssets.sort(sortAccountAssets);
          const approxValues = pricedAssets
            .map((asset) => asset.approxUsd)
            .filter((value): value is number => value !== null);
          const approxUsd = approxValues.length
            ? roundUsdNumber(approxValues.reduce((sum, value) => sum + value, 0))
            : null;

          status = pricedAssets.length > 0 ? "ok" : "empty";
          spotUpdatedAt = updatedAt;
          totals = {
            assets: pricedAssets.length,
            approxUsd
          };
          assets = pricedAssets;
        }
      } catch (error) {
        status = "error";
        spotError = routeErrorPayload(error);
      }

      let perp = createEmptyPerpOverview(quoteAsset);
      try {
        const supportsPerp = resolveManualPerpSupport({
          exchange: selectedExchange,
          marketDataExchange
        });

        if (supportsPerp) {
          const accountState = selectedExchange === "paper"
            ? await (async () => {
                const client = perpMarketDataClientFactory(resolved.marketDataAccount, "/exchange-accounts/assets");
                try {
                  return deps.getPaperAccountState(resolved.selectedAccount, client);
                } finally {
                  await client.close();
                }
              })()
            : await (async () => {
                const adapter = perpExecutionAdapterFactory(resolved.marketDataAccount);
                try {
                  return adapter.getAccountState();
                } finally {
                  await adapter.close();
                }
              })();
          const equityUsd = roundUsdNumber(toFiniteNumber(accountState?.equity));
          const availableMarginUsd = roundUsdNumber(toFiniteNumber(accountState?.availableMargin));
          perp = {
            status: resolvePerpStatus(equityUsd, availableMarginUsd),
            updatedAt,
            error: null,
            marginAsset: quoteAsset,
            equityUsd,
            availableMarginUsd,
            marginMode: normalizeMarginMode(accountState?.marginMode)
          };
        }
      } catch (error) {
        perp = {
          ...createEmptyPerpOverview(quoteAsset),
          status: "error",
          error: routeErrorPayload(error)
        };
      }

      if (status === "error" || perp.status === "error") {
        partialErrors += 1;
      }

      return {
        ...base,
        exchange: selectedExchange || base.exchange,
        marketDataExchange,
        status,
        updatedAt: spotUpdatedAt,
        error: spotError,
        quoteAsset,
        totals,
        assets,
        perp
      };
    }));

    return res.json({
      accounts,
      meta: {
        updatedAt,
        partialErrors
      }
    });
  });

  app.get("/exchange-accounts", requireAuth, async (req, res) => {
    const user = getUserFromLocals(res);
    const purpose = typeof req.query.purpose === "string" ? req.query.purpose.trim().toLowerCase() : "";
    const executionOnly = purpose === "execution";
    const rows = await deps.db.exchangeAccount.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" }
    });

    const paperIds = rows
      .filter((row: any) => deps.normalizeExchangeValue(String(row.exchange ?? "")) === "paper")
      .map((row: any) => String(row.id));
    const paperBindings = await deps.listPaperMarketDataAccountIds(paperIds);
    const linkedIds = Array.from(
      new Set(
        Object.values(paperBindings)
          .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
      )
    );
    const linkedAccounts = linkedIds.length > 0
      ? await deps.db.exchangeAccount.findMany({
          where: { userId: user.id, id: { in: linkedIds } },
          select: { id: true, exchange: true, label: true }
        })
      : [];
    const linkedById = new Map<string, { exchange: string; label: string }>(
      linkedAccounts.map((row: any) => [
        row.id,
        { exchange: String(row.exchange ?? ""), label: String(row.label ?? "") }
      ])
    );

    const items = rows.map((row: any) => {
      let apiKeyMasked = "****";
      let signingAddress: string | null = null;
      let readAddress: string | null = null;
      let readAddressSource: "wallet" | "account_or_vault" | null = null;
      try {
        const apiKey = deps.decryptSecret(row.apiKeyEnc);
        apiKeyMasked = deps.maskSecret(apiKey);
        if (deps.normalizeExchangeValue(String(row.exchange ?? "")) === "hyperliquid") {
          signingAddress = normalizeAddress(apiKey);
          const passphrase = row.passphraseEnc ? deps.decryptSecret(row.passphraseEnc) : null;
          readAddress = normalizeAddress(passphrase) ?? signingAddress;
          readAddressSource = normalizeAddress(passphrase) ? "account_or_vault" : signingAddress ? "wallet" : null;
        }
      } catch {
        apiKeyMasked = "****";
      }
      const linkedMarketDataId = paperBindings[row.id] ?? null;
      const linkedMarketData = linkedMarketDataId ? linkedById.get(linkedMarketDataId) ?? null : null;
      const exchange = deps.normalizeExchangeValue(String(row.exchange ?? ""));
      const marketDataExchange = linkedMarketData?.exchange ?? exchange;
      return {
        id: row.id,
        exchange: row.exchange,
        label: row.label,
        apiKeyMasked,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
        lastUsedAt: row.lastUsedAt,
        futuresBudget:
          row.futuresBudgetEquity !== null || row.futuresBudgetAvailableMargin !== null
            ? {
                equity: row.futuresBudgetEquity,
                availableMargin: row.futuresBudgetAvailableMargin,
                marginCoin: exchange === "hyperliquid" ? "USDC" : "USDT"
              }
            : null,
        lastSyncError:
          row.lastSyncErrorAt || row.lastSyncErrorMessage
            ? {
                at: row.lastSyncErrorAt instanceof Date ? row.lastSyncErrorAt.toISOString() : null,
                message: row.lastSyncErrorMessage ?? null
              }
            : null,
        marketDataExchangeAccountId: linkedMarketDataId,
        marketDataExchange: linkedMarketData?.exchange ?? null,
        marketDataLabel: linkedMarketData?.label ?? null,
        signingAddress,
        readAddress,
        readAddressSource,
        ...deriveHyperliquidCredentialExpiryState({
          exchange: row.exchange,
          credentialsRotatedAt: row.credentialsRotatedAt,
          createdAt: row.createdAt
        }),
        supportsSpotManual: resolveManualSpotSupport({ exchange, marketDataExchange }),
        supportsPerpManual: resolveManualPerpSupport({ exchange, marketDataExchange })
      };
    });

    return res.json({
      items: executionOnly
        ? items.filter((item) => Boolean(item.supportsSpotManual || item.supportsPerpManual))
        : items
    });
  });

  app.post("/exchange-accounts", requireAuth, async (req, res) => {
    const user = getUserFromLocals(res);
    const parsed = exchangeCreateSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "invalid_payload", details: parsed.error.flatten() });
    }

    const requestedExchange = deps.normalizeExchangeValue(parsed.data.exchange);
    if (requestedExchange === "mexc" && !deps.isMexcEnabledAtRuntime()) {
      return res.status(403).json({ error: "exchange_disabled", code: "mexc_disabled", message: "MEXC integration is disabled by runtime flag." });
    }
    if (requestedExchange === "binance" && !deps.isBinanceEnabledAtRuntime()) {
      return res.status(403).json({ error: "exchange_disabled", code: "binance_disabled", message: "Binance integration is disabled by runtime flag." });
    }
    if (requestedExchange === "bingx" && !deps.isBingxEnabledAtRuntime()) {
      return res.status(403).json({ error: "exchange_disabled", code: "bingx_disabled", message: "BingX integration is disabled by runtime flag." });
    }
    const allowedExchanges = await deps.getAllowedExchangeValues();
    if (!allowedExchanges.includes(requestedExchange)) {
      return res.status(400).json({ error: "exchange_not_allowed", allowed: allowedExchanges });
    }
    if (requestedExchange === "paper") {
      const capabilityContext = await deps.resolvePlanCapabilitiesForUserId({
        userId: user.id
      });
      if (!deps.isCapabilityAllowed(capabilityContext.capabilities, "product.paper_trading")) {
        return deps.sendCapabilityDenied(res, {
          capability: "product.paper_trading",
          currentPlan: capabilityContext.plan,
          legacyCode: "paper_trading_not_available"
        });
      }
    }

    let marketDataExchangeAccountId: string | null = null;
    if (requestedExchange === "paper") {
      marketDataExchangeAccountId = parsed.data.marketDataExchangeAccountId?.trim() || null;
      if (!marketDataExchangeAccountId) {
        return res.status(400).json({ error: "paper_market_data_account_required" });
      }
      const marketDataAccount = await deps.db.exchangeAccount.findFirst({
        where: { id: marketDataExchangeAccountId, userId: user.id },
        select: { id: true, exchange: true }
      });
      if (!marketDataAccount) {
        return res.status(404).json({ error: "paper_market_data_account_not_found" });
      }
      if (!isValidPaperLinkedMarketDataExchange(marketDataAccount.exchange)) {
        return res.status(400).json({ error: "paper_market_data_account_invalid" });
      }
    }

    const createAccount = (tx: any) => tx.exchangeAccount.create({
      data: {
        userId: user.id,
        exchange: requestedExchange,
        label: parsed.data.label,
        apiKeyEnc: deps.encryptSecret(parsed.data.apiKey?.trim() || `paper_${crypto.randomUUID()}`),
        apiSecretEnc: deps.encryptSecret(parsed.data.apiSecret?.trim() || `paper_${crypto.randomUUID()}`),
        passphraseEnc: requestedExchange === "paper" ? null : parsed.data.passphrase ? deps.encryptSecret(parsed.data.passphrase) : null,
        credentialsRotatedAt: isHyperliquidExchange(requestedExchange) ? new Date() : null,
        credentialsExpiryNoticeSentAt: null
      }
    });
    const admission = typeof deps.createExchangeAccountWithAdmission === "function"
      ? await deps.createExchangeAccountWithAdmission({
          userId: user.id,
          exchange: requestedExchange,
          create: createAccount
        })
      : {
          outcome: "allowed" as const,
          value: await createAccount(deps.db),
          limit: null,
          usage: 0,
          counted: requestedExchange !== "paper"
        };
    if (admission.outcome === "denied") {
      return res.status(403).json({
        error: admission.reason,
        code: admission.reason,
        message: admission.reason,
        details: {
          limit: admission.limit,
          usage: admission.usage,
          remaining: 0,
          paperAccountsExcluded: true
        }
      });
    }
    const created = admission.value;

    if (requestedExchange === "paper" && marketDataExchangeAccountId) {
      await deps.setPaperMarketDataAccountId(created.id, marketDataExchangeAccountId);
    }

    return res.status(201).json({
      id: created.id,
      exchange: created.exchange,
      label: created.label,
      apiKeyMasked: parsed.data.apiKey
        ? deps.maskSecret(parsed.data.apiKey)
        : requestedExchange === "paper"
          ? "paper"
          : "****",
      marketDataExchangeAccountId
    });
  });

  app.put("/exchange-accounts/:id", requireAuth, async (req, res) => {
    const user = getUserFromLocals(res);
    const id = readRouteParam(req, "id");
    const parsed = exchangeUpdateSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "invalid_payload", details: parsed.error.flatten() });
    }

    const existing: ExchangeAccountSecretsLike & { label: string } | null = await deps.db.exchangeAccount.findFirst({
      where: { id, userId: user.id },
      select: {
        id: true,
        userId: true,
        exchange: true,
        label: true,
        apiKeyEnc: true,
        apiSecretEnc: true,
        passphraseEnc: true
      }
    });
    if (!existing) {
      return res.status(404).json({ error: "exchange_account_not_found" });
    }

    const requestedExchange = deps.normalizeExchangeValue(existing.exchange);
    if (requestedExchange === "paper") {
      const capabilityContext = await deps.resolvePlanCapabilitiesForUserId({
        userId: user.id
      });
      if (!deps.isCapabilityAllowed(capabilityContext.capabilities, "product.paper_trading")) {
        return deps.sendCapabilityDenied(res, {
          capability: "product.paper_trading",
          currentPlan: capabilityContext.plan,
          legacyCode: "paper_trading_not_available"
        });
      }
    }
    const currentApiKey = deps.decryptSecret(existing.apiKeyEnc);
    const currentApiSecret = deps.decryptSecret(existing.apiSecretEnc);
    const nextApiKey = parsed.data.apiKey?.trim() || currentApiKey;
    const nextApiSecret = parsed.data.apiSecret?.trim() || currentApiSecret;
    const currentPassphrase = existing.passphraseEnc ? deps.decryptSecret(existing.passphraseEnc) : undefined;
    const nextPassphrase = parsed.data.clearPassphrase
      ? undefined
      : (parsed.data.passphrase !== undefined && parsed.data.passphrase.trim() !== ""
          ? parsed.data.passphrase.trim()
          : currentPassphrase);
    const hyperliquidCredentialsChanged =
      isHyperliquidExchange(requestedExchange)
      && (
        (parsed.data.apiKey?.trim() ? parsed.data.apiKey.trim() !== currentApiKey : false)
        || (parsed.data.apiSecret?.trim() ? parsed.data.apiSecret.trim() !== currentApiSecret : false)
      );
    const nextMarketDataExchangeAccountId = requestedExchange === "paper"
      ? parsed.data.marketDataExchangeAccountId?.trim()
      : undefined;

    const validation = exchangeCreateSchema.safeParse({
      exchange: requestedExchange,
      label: parsed.data.label,
      apiKey: requestedExchange === "paper" ? undefined : nextApiKey,
      apiSecret: requestedExchange === "paper" ? undefined : nextApiSecret,
      passphrase: requestedExchange === "paper" ? undefined : nextPassphrase,
      marketDataExchangeAccountId: nextMarketDataExchangeAccountId
    });
    if (!validation.success) {
      return res.status(400).json({ error: "invalid_payload", details: validation.error.flatten() });
    }

    let marketDataExchangeAccountId: string | null = null;
    if (requestedExchange === "paper") {
      marketDataExchangeAccountId = nextMarketDataExchangeAccountId || null;
      if (!marketDataExchangeAccountId) {
        return res.status(400).json({ error: "paper_market_data_account_required" });
      }
      if (marketDataExchangeAccountId === id) {
        return res.status(400).json({ error: "paper_market_data_account_invalid" });
      }
      const marketDataAccount = await deps.db.exchangeAccount.findFirst({
        where: { id: marketDataExchangeAccountId, userId: user.id },
        select: { id: true, exchange: true }
      });
      if (!marketDataAccount) {
        return res.status(404).json({ error: "paper_market_data_account_not_found" });
      }
      if (!isValidPaperLinkedMarketDataExchange(marketDataAccount.exchange)) {
        return res.status(400).json({ error: "paper_market_data_account_invalid" });
      }
    }

    const updated = await deps.db.exchangeAccount.update({
      where: { id },
      data: {
        label: parsed.data.label,
        apiKeyEnc: requestedExchange === "paper"
          ? existing.apiKeyEnc
          : deps.encryptSecret(nextApiKey),
        apiSecretEnc: requestedExchange === "paper"
          ? existing.apiSecretEnc
          : deps.encryptSecret(nextApiSecret),
        passphraseEnc: requestedExchange === "paper"
          ? null
          : nextPassphrase
            ? deps.encryptSecret(nextPassphrase)
            : null,
        ...(hyperliquidCredentialsChanged
          ? {
              credentialsRotatedAt: new Date(),
              credentialsExpiryNoticeSentAt: null
            }
          : {})
      }
    });

    if (requestedExchange === "paper" && marketDataExchangeAccountId) {
      await deps.setPaperMarketDataAccountId(id, marketDataExchangeAccountId);
    }

    return res.json({
      id: updated.id,
      exchange: updated.exchange,
      label: updated.label,
      apiKeyMasked: requestedExchange === "paper"
        ? "paper"
        : deps.maskSecret(nextApiKey),
      marketDataExchangeAccountId
    });
  });

  app.delete("/exchange-accounts/:id", requireAuth, async (req, res) => {
    const user = getUserFromLocals(res);
    const id = readRouteParam(req, "id");
    const account = await deps.db.exchangeAccount.findFirst({ where: { id, userId: user.id } });
    if (!account) return res.status(404).json({ error: "exchange_account_not_found" });

    const linkedBots = await deps.db.bot.count({ where: { userId: user.id, exchangeAccountId: id } });
    if (linkedBots > 0) {
      return res.status(409).json({ error: "exchange_account_in_use" });
    }

    const paperAccounts = await deps.db.exchangeAccount.findMany({
      where: { userId: user.id, exchange: "paper" },
      select: { id: true }
    });
    const bindings = await deps.listPaperMarketDataAccountIds(paperAccounts.map((row: any) => row.id));
    const dependentPaperAccountIds = paperAccounts
      .map((row: any) => row.id as string)
      .filter((paperId) => paperId !== id && bindings[paperId] === id);
    if (dependentPaperAccountIds.length > 0) {
      return res.status(409).json({ error: "exchange_account_in_use_by_paper", dependentPaperAccountIds });
    }

    await deps.db.exchangeAccount.delete({ where: { id } });
    await deps.clearPaperMarketDataAccountId(id);
    await deps.clearPaperState(id);
    return res.json({ ok: true });
  });

  app.post("/exchange-accounts/:id/test-connection", requireAuth, async (req, res) => {
    const user = getUserFromLocals(res);
    const id = readRouteParam(req, "id");
    const account: ExchangeAccountSecretsLike | null = await deps.db.exchangeAccount.findFirst({
      where: { id, userId: user.id },
      select: {
        id: true,
        userId: true,
        exchange: true,
        apiKeyEnc: true,
        apiSecretEnc: true,
        passphraseEnc: true
      }
    });
    if (!account) return res.status(404).json({ error: "exchange_account_not_found" });

    if (deps.normalizeExchangeValue(account.exchange) === "paper") {
      try {
        const resolved = await deps.resolveMarketDataTradingAccount(user.id, account.id);
        const marketDataExchange = deps.normalizeExchangeValue(resolved.marketDataAccount.exchange);
        const perpClient = createManualPerpMarketDataClient(resolved.marketDataAccount, "/exchange-accounts/:id/test-connection");
        try {
          const summary = await deps.getPaperAccountState(resolved.selectedAccount, perpClient);
          let paperSpotBudget: Awaited<ReturnType<typeof syncExchangeAccount>>["spotBudget"] = null;
          if (marketDataExchange === "bitget" || marketDataExchange === "binance" || marketDataExchange === "bingx") {
            try {
              const spotClient = createManualSpotClient(resolved.marketDataAccount, "/exchange-accounts/:id/test-connection");
              const spotSummary = await deps.getPaperSpotAccountState(resolved.selectedAccount, spotClient);
              paperSpotBudget = {
                total: spotSummary.equity ?? null,
                available: spotSummary.availableMargin ?? null,
                currency: "USDT"
              };
            } catch {
              paperSpotBudget = null;
            }
          }
          const synced: Awaited<ReturnType<typeof syncExchangeAccount>> = {
            syncedAt: new Date(),
            spotBudget: paperSpotBudget,
            futuresBudget: {
              equity: summary.equity,
              availableMargin: summary.availableMargin,
              marginCoin: "USDT"
            },
            pnlTodayUsd: null,
            details: {
              exchange: "paper",
              endpoint: "paper/simulated"
            }
          };
          await deps.persistExchangeSyncSuccess(account.userId, account.id, synced);
          return res.json({
            ok: true,
            message: "paper_sync_ok",
            syncedAt: synced.syncedAt.toISOString(),
            spotBudget: synced.spotBudget,
            futuresBudget: synced.futuresBudget,
            pnlTodayUsd: synced.pnlTodayUsd,
            details: synced.details
          });
        } finally {
          await perpClient.close();
        }
      } catch (error) {
        return deps.sendManualTradingError(res, error);
      }
    }

    try {
      const synced = await deps.executeExchangeSync(account);
      await deps.persistExchangeSyncSuccess(account.userId, account.id, synced);

      return res.json({
        ok: true,
        message: "sync_ok",
        syncedAt: synced.syncedAt.toISOString(),
        spotBudget: synced.spotBudget,
        futuresBudget: synced.futuresBudget,
        pnlTodayUsd: synced.pnlTodayUsd,
        details: synced.details
      });
    } catch (error) {
      await deps.persistExchangeSyncFailure(
        account.id,
        error instanceof deps.ExchangeSyncError ? error.message : "Manual sync failed due to unexpected error."
      );

      if (error instanceof deps.ExchangeSyncError) {
        return res.status(error.status).json({ error: error.message, code: error.code });
      }
      return res.status(500).json({ error: "exchange_sync_failed", message: "Unexpected exchange sync failure." });
    }
  });
}
