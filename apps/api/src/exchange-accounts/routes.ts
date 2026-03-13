import crypto from "crypto";
import express from "express";
import { z } from "zod";
import { getUserFromLocals, requireAuth } from "../auth.js";
import { type syncExchangeAccount, ExchangeSyncError } from "../exchange-sync.js";
import type { TradingAccount } from "../trading.js";
import {
  createManualPerpMarketDataClient,
  createManualSpotClient,
  resolveManualPerpSupport,
  resolveManualSpotSupport
} from "../manual-trading/support.js";
import { isValidPaperLinkedMarketDataExchange } from "../paper/policy.js";

type ExchangeAccountSecretsLike = {
  id: string;
  userId: string;
  exchange: string;
  apiKeyEnc: string;
  apiSecretEnc: string;
  passphraseEnc: string | null;
};

const exchangeCreateSchema = z.object({
  exchange: z.string().trim().min(1),
  label: z.string().trim().min(1),
  apiKey: z.string().trim().optional(),
  apiSecret: z.string().trim().optional(),
  passphrase: z.string().trim().optional(),
  marketDataExchangeAccountId: z.string().trim().optional()
}).superRefine((value, ctx) => {
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
  if (exchange !== "paper" && exchange !== "binance" && !value.apiKey) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["apiKey"], message: "apiKey is required" });
  }
  if (exchange !== "paper" && exchange !== "binance" && !value.apiSecret) {
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
});

export type RegisterExchangeAccountRoutesDeps = {
  db: any;
  decryptSecret(value: string): string;
  encryptSecret(value: string): string;
  maskSecret(value: string): string;
  normalizeExchangeValue(value: string): string;
  isMexcEnabledAtRuntime(): boolean;
  isBinanceEnabledAtRuntime(): boolean;
  getAllowedExchangeValues(): Promise<string[]>;
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
  ): Promise<{ equity: number | null; availableMargin: number | null }>;
  getPaperSpotAccountState(
    account: TradingAccount,
    client: ReturnType<typeof createManualSpotClient>
  ): Promise<{ equity: number | null; availableMargin: number | null }>;
  persistExchangeSyncSuccess(
    userId: string,
    accountId: string,
    synced: Awaited<ReturnType<typeof syncExchangeAccount>>
  ): Promise<void>;
  persistExchangeSyncFailure(accountId: string, errorMessage: string): Promise<void>;
  executeExchangeSync(account: ExchangeAccountSecretsLike): Promise<Awaited<ReturnType<typeof syncExchangeAccount>>>;
  ExchangeSyncError: typeof ExchangeSyncError;
  sendManualTradingError(res: express.Response, error: unknown): express.Response;
};

export function registerExchangeAccountRoutes(
  app: express.Express,
  deps: RegisterExchangeAccountRoutesDeps
) {
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
      try {
        apiKeyMasked = deps.maskSecret(deps.decryptSecret(row.apiKeyEnc));
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
    const allowedExchanges = await deps.getAllowedExchangeValues();
    if (!allowedExchanges.includes(requestedExchange)) {
      return res.status(400).json({ error: "exchange_not_allowed", allowed: allowedExchanges });
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

    const created = await deps.db.exchangeAccount.create({
      data: {
        userId: user.id,
        exchange: requestedExchange,
        label: parsed.data.label,
        apiKeyEnc: deps.encryptSecret(parsed.data.apiKey?.trim() || `paper_${crypto.randomUUID()}`),
        apiSecretEnc: deps.encryptSecret(parsed.data.apiSecret?.trim() || `paper_${crypto.randomUUID()}`),
        passphraseEnc: requestedExchange === "paper" ? null : parsed.data.passphrase ? deps.encryptSecret(parsed.data.passphrase) : null
      }
    });

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
          : requestedExchange === "binance"
            ? "public"
            : "****",
      marketDataExchangeAccountId
    });
  });

  app.delete("/exchange-accounts/:id", requireAuth, async (req, res) => {
    const user = getUserFromLocals(res);
    const id = req.params.id;
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
    const id = req.params.id;
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
          if (marketDataExchange === "bitget" || marketDataExchange === "binance") {
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
