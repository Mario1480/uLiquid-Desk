import crypto from "node:crypto";
import type { Express } from "express";
import {
  buildOrderReferenceIdentity,
  collectCanonicalOrderReferenceKeys,
  collectOrderReferenceCandidates,
  collectOrderReferenceSet
} from "@mm/futures-exchange";
import { getUserFromLocals, requireAuth } from "../auth.js";
import {
  buildGridLiveVenueConstraintsRequiredErrorResponse,
  buildGridMinimumInvestmentErrorResponse,
  buildGridPreviewResponse
} from "./previewValidation.js";

export function registerGridInstanceRoutes(app: Express, deps: any, shared: any) {
  const GRID_PENDING_PROVISIONING_TTL_MS = 30 * 60 * 1000;
  const HYPERVAULT_CREATE_FEE_USD = 1;
  type ReusedBotVaultBinding = {
    botVaultId: string;
    previousGridInstanceId: string | null;
    previousBotId: string | null;
    previousTemplateId: string | null;
    previousStatus: string;
    previousExecutionStatus: string | null;
    previousExecutionLastError: string | null;
    previousExecutionLastErrorAt: Date | string | null;
    previousExecutionMetadata: unknown;
  };

  function normalizeGridIntentType(value: unknown): "entry" | "tp" | "sl" | "rebalance" {
    const normalized = String(value ?? "").trim().toLowerCase();
    if (normalized === "tp" || normalized === "sl" || normalized === "rebalance") return normalized;
    return "entry";
  }

  function normalizeDbText(value: unknown): string {
    return String(value ?? "").trim();
  }

  function isAmbiguousBareNumericRef(value: string): boolean {
    return /^\d+$/.test(String(value ?? "").trim());
  }

  function inferGridIndex(value: unknown): number {
    const raw = normalizeDbText(value);
    const match = /-(\d+)$/.exec(raw);
    if (!match) return 0;
    const parsed = Number(match[1]);
    return Number.isFinite(parsed) ? Math.max(0, Math.trunc(parsed)) : 0;
  }

  function inferGridLeg(params: {
    rawLeg?: unknown;
    clientOrderId?: unknown;
    side?: unknown;
    rawDir?: unknown;
  }): "long" | "short" {
    const directLeg = normalizeDbText(params.rawLeg).toLowerCase();
    if (directLeg === "short") return "short";
    if (directLeg === "long") return "long";

    const clientOrderId = normalizeDbText(params.clientOrderId).toLowerCase();
    if (clientOrderId.includes("-short-")) return "short";
    if (clientOrderId.includes("-long-")) return "long";

    const rawDir = normalizeDbText(params.rawDir).toLowerCase();
    if (rawDir.includes("short")) return "short";
    if (rawDir.includes("long")) return "long";

    return String(params.side ?? "").trim().toLowerCase() === "sell" ? "short" : "long";
  }

  function buildGridOrderLookup(rows: any[]): Map<string, {
    clientOrderId: string | null;
    exchangeOrderId: string | null;
    gridLeg: "long" | "short";
    gridIndex: number;
    intentType: "entry" | "tp" | "sl" | "rebalance";
  }> {
    const lookup = new Map<string, {
      clientOrderId: string | null;
      exchangeOrderId: string | null;
      gridLeg: "long" | "short";
      gridIndex: number;
      intentType: "entry" | "tp" | "sl" | "rebalance";
    }>();

    for (const row of Array.isArray(rows) ? rows : []) {
      const metadata = row?.metadata && typeof row.metadata === "object" && !Array.isArray(row.metadata)
        ? row.metadata
        : {};
      const clientOrderId = normalizeDbText(row?.clientOrderId || metadata.clientOrderId) || null;
      const exchangeOrderId = normalizeDbText(row?.exchangeOrderId || metadata.exchangeOrderId) || null;
      const entry = {
        clientOrderId,
        exchangeOrderId,
        gridLeg: inferGridLeg({
          rawLeg: row?.gridLeg ?? metadata.gridLeg,
          clientOrderId,
          side: row?.side,
          rawDir: metadata?.raw && typeof metadata.raw === "object" ? (metadata.raw as Record<string, unknown>).dir : null
        }),
        gridIndex: Number.isFinite(Number(row?.gridIndex))
          ? Math.max(0, Math.trunc(Number(row.gridIndex)))
          : inferGridIndex(clientOrderId),
        intentType: normalizeGridIntentType(row?.intentType ?? metadata.intentType)
      };
      const refs = new Set<string>([
        ...buildOrderReferenceIdentity({ clientOrderId, exchangeOrderId }).keys,
        ...[...collectOrderReferenceSet([clientOrderId, exchangeOrderId])]
          .filter((ref) => !isAmbiguousBareNumericRef(ref))
      ]);
      for (const ref of refs) {
        if (!lookup.has(ref)) lookup.set(ref, entry);
      }
    }

    return lookup;
  }

  function mergeGridOrders(primary: any[], fallback: any[]): any[] {
    const merged: any[] = [];
    const seen = new Set<string>();
    for (const row of [...(Array.isArray(primary) ? primary : []), ...(Array.isArray(fallback) ? fallback : [])]) {
      const refs = new Set<string>(buildOrderReferenceIdentity({
        clientOrderId: row?.clientOrderId,
        exchangeOrderId: row?.exchangeOrderId
      }).keys);
      let duplicate = false;
      for (const ref of refs) {
        if (seen.has(ref)) {
          duplicate = true;
          break;
        }
      }
      if (duplicate) continue;
      for (const ref of refs) seen.add(ref);
      merged.push(row);
    }
    return merged.sort((left, right) => new Date(String(right?.updatedAt ?? 0)).getTime() - new Date(String(left?.updatedAt ?? 0)).getTime());
  }

  function shouldHidePendingSignatureInstance(item: Record<string, any> | null | undefined): boolean {
    const phase = String(item?.provisioningStatus?.phase ?? "").trim().toLowerCase();
    return phase === "pending_signature"
      || phase === "pending_reserve_signature"
      || phase === "pending_hypercore_funding_signature";
  }

  function isCancelableProvisioningSignaturePhase(phase: string | null): boolean {
    return phase === "pending_signature" || phase === "pending_reserve_signature";
  }

  function readProvisioningPhase(value: unknown): string | null {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const provisioning = (value as Record<string, unknown>).provisioning;
    if (!provisioning || typeof provisioning !== "object" || Array.isArray(provisioning)) return null;
    const phase = String((provisioning as Record<string, unknown>).phase ?? "").trim().toLowerCase();
    return phase || null;
  }

  function readProvisioningStartedAt(value: unknown): Date | null {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const provisioning = (value as Record<string, unknown>).provisioning;
    if (!provisioning || typeof provisioning !== "object" || Array.isArray(provisioning)) return null;
    const raw = String((provisioning as Record<string, unknown>).startedAt ?? "").trim();
    if (!raw) return null;
    const parsed = new Date(raw);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  async function cancelPendingProvisioningForInstance(params: {
    userId: string;
    instanceId: string;
    allowStaleSubmitted?: boolean;
    reason: string;
  }): Promise<{ cleaned: boolean; skippedReason?: string | null }> {
    const row = await deps.db.gridBotInstance.findFirst({
      where: {
        id: params.instanceId,
        userId: params.userId
      },
      include: {
        bot: {
          include: {
            futuresConfig: true
          }
        }
      }
    });
    if (!row) return { cleaned: false, skippedReason: "grid_instance_not_found" };

    const phase = readProvisioningPhase(row.stateJson);
    if (!isCancelableProvisioningSignaturePhase(phase)) {
      return { cleaned: false, skippedReason: "grid_instance_not_pending_signature" };
    }

    const botVault = await deps.db.botVault.findFirst({
      where: {
        gridInstanceId: row.id,
        userId: params.userId
      },
      include: {
        onchainActions: {
          orderBy: [{ updatedAt: "desc" }]
        }
      }
    });
    if (!botVault) return { cleaned: false, skippedReason: "bot_vault_not_found" };

    const pendingProvisioningAction = Array.isArray(botVault.onchainActions)
      ? botVault.onchainActions.find((entry: any) => {
          const actionType = String(entry?.actionType ?? "").trim();
          return actionType === "create_bot_vault" || actionType === "create_bot_vault_v3" || actionType === "fund_bot_vault_v3";
        })
      : null;
    const pendingProvisioningActionType = String(pendingProvisioningAction?.actionType ?? "").trim();
    const actionStatus = String(pendingProvisioningAction?.status ?? "").trim().toLowerCase();
    if (actionStatus && actionStatus !== "prepared") {
      if (!(params.allowStaleSubmitted && actionStatus === "submitted")) {
        return { cleaned: false, skippedReason: `action_not_cancelable:${actionStatus}` };
      }
    }

    const onchainVaultAddress = String(botVault.vaultAddress ?? "").trim();
    const botVaultMetadata = botVault.executionMetadata && typeof botVault.executionMetadata === "object" && !Array.isArray(botVault.executionMetadata)
      ? botVault.executionMetadata as Record<string, unknown>
      : {};
    const pendingReuseBinding = botVaultMetadata.pendingReuseBinding && typeof botVaultMetadata.pendingReuseBinding === "object" && !Array.isArray(botVaultMetadata.pendingReuseBinding)
      ? botVaultMetadata.pendingReuseBinding as Record<string, unknown>
      : null;
    const isReusableRefillCancel = pendingProvisioningActionType === "fund_bot_vault_v3" && Boolean(onchainVaultAddress) && Boolean(pendingReuseBinding);

    if (onchainVaultAddress && !isReusableRefillCancel) {
      return { cleaned: false, skippedReason: "bot_vault_onchain_already_created" };
    }

    const allocatedUsd = Number(botVault.allocatedUsd ?? 0);
    const principalAllocated = Number(botVault.principalAllocated ?? 0);
    const availableUsd = Number(botVault.availableUsd ?? 0);
    if (!isReusableRefillCancel && (allocatedUsd > 0 || principalAllocated > 0 || availableUsd > 0)) {
      return { cleaned: false, skippedReason: "bot_vault_reserved_or_allocated" };
    }

    await deps.db.$transaction(async (tx: any) => {
      await tx.onchainAction.deleteMany({
        where: {
          botVaultId: String(botVault.id),
          actionType: pendingProvisioningActionType || "create_bot_vault",
          status: params.allowStaleSubmitted ? { in: ["prepared", "submitted"] } : "prepared"
        }
      }).catch(() => ({ count: 0 }));
      if (isReusableRefillCancel && pendingReuseBinding) {
        const previousExecutionMetadata = pendingReuseBinding.previousExecutionMetadata ?? null;
        await tx.botVault.update({
          where: { id: String(botVault.id) },
          data: {
            gridInstanceId: pendingReuseBinding.previousGridInstanceId
              ? String(pendingReuseBinding.previousGridInstanceId)
              : null,
            botId: pendingReuseBinding.previousBotId
              ? String(pendingReuseBinding.previousBotId)
              : null,
            templateId: pendingReuseBinding.previousTemplateId
              ? String(pendingReuseBinding.previousTemplateId)
              : "legacy_grid_default",
            status: String(pendingReuseBinding.previousStatus ?? "ACTIVE"),
            executionStatus: pendingReuseBinding.previousExecutionStatus == null
              ? null
              : String(pendingReuseBinding.previousExecutionStatus),
            executionLastError: pendingReuseBinding.previousExecutionLastError == null
              ? null
              : String(pendingReuseBinding.previousExecutionLastError),
            executionLastErrorAt: pendingReuseBinding.previousExecutionLastErrorAt == null
              ? null
              : new Date(String(pendingReuseBinding.previousExecutionLastErrorAt)),
            executionMetadata: previousExecutionMetadata
          }
        });
      } else {
        await tx.botVault.deleteMany({ where: { id: String(botVault.id) } });
      }
      await tx.gridBotInstance.deleteMany({ where: { id: String(row.id) } });
      if (row.botId) {
        await tx.botRuntime.deleteMany({ where: { botId: String(row.botId) } }).catch(() => ({ count: 0 }));
        await tx.futuresBotConfig.deleteMany({ where: { botId: String(row.botId) } }).catch(() => ({ count: 0 }));
        await tx.bot.deleteMany({ where: { id: String(row.botId) } }).catch(() => ({ count: 0 }));
      }
    });

    return { cleaned: true, skippedReason: null };
  }

  async function cleanupStalePendingProvisioningForUser(userId: string): Promise<void> {
    const threshold = Date.now() - GRID_PENDING_PROVISIONING_TTL_MS;
    const rows = await deps.db.gridBotInstance.findMany({
      where: { userId },
      select: {
        id: true,
        stateJson: true
      }
    }).catch(() => []);
    for (const row of rows) {
      const phase = readProvisioningPhase(row?.stateJson);
      if (!isCancelableProvisioningSignaturePhase(phase)) continue;
      const startedAt = readProvisioningStartedAt(row?.stateJson);
      if (!startedAt || startedAt.getTime() > threshold) continue;
      await cancelPendingProvisioningForInstance({
        userId,
        instanceId: String(row.id),
        allowStaleSubmitted: false,
        reason: "stale_pending_signature_cleanup"
      }).catch(() => undefined);
    }
  }

  async function resolveCurrentAllowedGridExchanges(user: { id: string; email?: string | null }): Promise<Set<string>> {
    const [pilotAccess, executionContext] = await Promise.all([
      deps.resolveGridHyperliquidPilotAccess(deps.db, {
        userId: user.id,
        email: user.email
      }),
      shared.getGridHyperliquidExecutionContext(deps.db)
    ]);
    return pilotAccess.allowed || executionContext.allowLiveHyperliquid
      ? new Set([...shared.allowedGridExchanges, "hyperliquid"])
      : shared.allowedGridExchanges;
  }

  function buildGridStartVaultErrorPayload(error: { code?: string; message?: string }) {
    const code = String(error?.code ?? "").trim();
    if (code === "grid_instance_vault_reconcile_required") {
      return {
        error: code,
        reason: String(error?.message ?? ""),
        vaultStatus: "vault_reconcile_required" as const
      };
    }
    if (code === "bot_vault_v3_execution_not_ready") {
      return {
        error: code,
        reason: String(error?.message ?? ""),
        vaultStatus: "vault_not_ready" as const
      };
    }
    return null;
  }

  app.post("/grid/templates/:id/instance-preview", requireAuth, async (req, res) => {
    if (!(await shared.requireGridFeatureEnabledOrRespond(res))) return;
    if (!(await shared.requireGridCapabilityOrRespond(res, deps))) return;
    const parsed = shared.gridInstancePreviewSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return res.status(400).json({ error: "invalid_payload", details: parsed.error.flatten() });
    }

    const user = getUserFromLocals(res);
    try {
      await cleanupStalePendingProvisioningForUser(user.id).catch(() => undefined);
      const [pilotAccess, executionContext] = await Promise.all([
        deps.resolveGridHyperliquidPilotAccess(deps.db, {
          userId: user.id,
          email: user.email
        }),
        shared.getGridHyperliquidExecutionContext(deps.db)
      ]);
      const allowHyperliquid = pilotAccess.allowed || executionContext.allowLiveHyperliquid;
      const template = await deps.db.gridBotTemplate.findFirst({
        where: {
          id: req.params.id,
          isPublished: true,
          isArchived: false
        }
      });
      if (!template) return res.status(404).json({ error: "grid_template_not_found" });
      const account = await deps.db.exchangeAccount.findFirst({
        where: {
          id: parsed.data.exchangeAccountId,
          userId: user.id
        }
      });
      if (!account) throw new deps.ManualTradingError("exchange account missing", 404, "exchange_account_not_found");
      const allowed = shared.ensureGridExchangeAllowed({
        exchange: account.exchange,
        allowedExchanges: allowHyperliquid ? new Set([...shared.allowedGridExchanges, "hyperliquid"]) : shared.allowedGridExchanges
      });
      if (!allowed.ok) {
        return res.status(400).json({ error: "grid_exchange_not_allowed", exchange: allowed.exchange, allowedExchanges: allowed.allowedExchanges });
      }
      const hyperliquidUsage = await shared.resolveGridHyperliquidAccountUsage({
        deps,
        userId: user.id,
        exchangeAccount: { id: account.id, exchange: String(account.exchange ?? "") },
        symbol: String(template.symbol ?? "")
      });
      if (hyperliquidUsage.usesHyperliquid && !allowHyperliquid) {
        return shared.sendGridHyperliquidPilotRequired(
          res,
          pilotAccess,
          account.id,
          hyperliquidUsage.marketDataVenue ?? "hyperliquid"
        );
      }
      if (!shared.isTemplatePolicyImplemented(template)) {
        return res.status(400).json({
          error: "grid_policy_not_implemented",
          reason: "WEIGHTED_NEAR_PRICE and DYNAMIC_BY_PRICE_POSITION are not enabled in v1.4"
        });
      }

      const templateMarginPolicy = String(template.marginPolicy ?? (template.allowAutoMargin ? "AUTO_ALLOWED" : "MANUAL_ONLY"));
      const requestedMarginMode = parsed.data.marginMode ?? (parsed.data.autoMarginEnabled ? "AUTO" : "MANUAL");
      if (requestedMarginMode === "AUTO" && templateMarginPolicy !== "AUTO_ALLOWED") {
        return res.status(400).json({ error: "grid_template_auto_margin_not_allowed" });
      }
      const autoMarginEnabled = requestedMarginMode === "AUTO";
      const selectedReusableBotVaultId = String(parsed.data.botVaultId ?? "").trim() || null;

      const fixedLeverage = Number(template.leverageDefault ?? template.leverageMin ?? 1);
      if (fixedLeverage < template.leverageMin || fixedLeverage > template.leverageMax) {
        return res.status(400).json({ error: "grid_template_leverage_invalid" });
      }
      const fixedSlippagePct = Number(template.slippageDefaultPct ?? 0.1);
      if (!(fixedSlippagePct >= 0.0001 && fixedSlippagePct <= 5)) {
        return res.status(400).json({ error: "grid_template_slippage_invalid" });
      }

      const useUnifiedHyperVaultCreateFlow =
        executionContext.provider === "hyperliquid"
        && String(account.exchange ?? "").trim().toLowerCase() === "hyperliquid"
        && hyperliquidUsage.usesHyperliquid
        && !selectedReusableBotVaultId;
      if (selectedReusableBotVaultId && !hyperliquidUsage.usesHyperliquid) {
        return res.status(400).json({ error: "grid_bot_vault_requires_hyperliquid" });
      }

      if (useUnifiedHyperVaultCreateFlow && deps.botVaultV3Service) {
        const agentWalletSummary = await deps.botVaultV3Service.getUserAgentWalletSummary({
          userId: user.id
        });
        const agentWalletAddress = String(agentWalletSummary?.address ?? "").trim();
        if (!agentWalletAddress) {
          return res.status(409).json({
            error: "grid_agent_wallet_required",
            reason: "agent_wallet_missing"
          });
        }
        if (String(agentWalletSummary?.lowHypeState ?? "").trim().toLowerCase() !== "ok") {
          return res.status(409).json({
            error: "grid_agent_wallet_hype_required",
            reason: String(agentWalletSummary?.lowHypeState ?? "unavailable")
          });
        }
      }

      const computed = await deps.computeGridPreviewAndAllocation({
        userId: user.id,
        exchangeAccountId: account.id,
        template,
        autoReservePolicy: template.autoReservePolicy ?? "LIQ_GUARD_MAX_GRID",
        autoReserveFixedGridPct: template.autoReserveFixedGridPct ?? 70,
        autoReserveTargetLiqDistancePct: template.autoReserveTargetLiqDistancePct ?? null,
        autoReserveMaxPreviewIterations: template.autoReserveMaxPreviewIterations ?? 8,
        investUsd: parsed.data.investUsd,
        extraMarginUsd: autoMarginEnabled ? 0 : parsed.data.extraMarginUsd,
        autoMarginEnabled,
        tpPct: parsed.data.tpPct ?? template.tpDefaultPct ?? null,
        slPrice: parsed.data.slPrice ?? template.slDefaultPrice ?? null,
        triggerPrice: parsed.data.triggerPrice ?? null,
        leverage: Math.trunc(fixedLeverage),
        slippagePct: fixedSlippagePct,
        resolveVenueContext: deps.resolveVenueContext
      });

      if (computed.allocation.insufficient || computed.allocation.gridInvestUsd + 1e-9 < computed.minInvestmentUSDT) {
        return res.status(400).json(buildGridMinimumInvestmentErrorResponse({
          computed,
          currentInvestUsd: parsed.data.investUsd,
          symbol: String(template.symbol ?? ""),
          marginMode: requestedMarginMode,
          autoMarginEnabled,
          leverage: Math.trunc(fixedLeverage),
        }));
      }

      return res.json(buildGridPreviewResponse({
        computed,
        marginMode: requestedMarginMode,
        autoMarginEnabled,
        leverage: Math.trunc(fixedLeverage),
        extras: {
          pilotAccess: {
            ...pilotAccess,
            provider: executionContext.provider,
            allowLiveHyperliquid: executionContext.allowLiveHyperliquid
          }
        }
      }));
    } catch (error) {
      if (error instanceof deps.ManualTradingError) {
        const manualError = error as any;
        return res.status(manualError.status).json({ error: manualError.code, reason: manualError.message });
      }
      if (shared.isMissingTableError(error)) return res.status(503).json({ error: "grid_schema_not_ready" });
      return res.status(503).json({ error: "grid_preview_failed", reason: String(error) });
    }
  });

  app.post("/grid/templates/:id/instances", requireAuth, async (req, res) => {
    if (!(await shared.requireGridFeatureEnabledOrRespond(res))) return;
    if (!(await shared.requireGridCapabilityOrRespond(res, deps))) return;
    const parsed = shared.gridInstanceCreateSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return res.status(400).json({ error: "invalid_payload", details: parsed.error.flatten() });
    }

    const user = getUserFromLocals(res);
    try {
      const [pilotAccess, executionContext] = await Promise.all([
        deps.resolveGridHyperliquidPilotAccess(deps.db, {
          userId: user.id,
          email: user.email
        }),
        shared.getGridHyperliquidExecutionContext(deps.db)
      ]);
      const allowHyperliquid = pilotAccess.allowed || executionContext.allowLiveHyperliquid;
      const template = await deps.db.gridBotTemplate.findFirst({
        where: {
          id: req.params.id,
          isPublished: true,
          isArchived: false
        }
      });
      if (!template) return res.status(404).json({ error: "grid_template_not_found" });
      const account = await deps.db.exchangeAccount.findFirst({
        where: {
          id: parsed.data.exchangeAccountId,
          userId: user.id
        }
      });
      if (!account) throw new deps.ManualTradingError("exchange account missing", 404, "exchange_account_not_found");
      const allowed = shared.ensureGridExchangeAllowed({
        exchange: account.exchange,
        allowedExchanges: allowHyperliquid ? new Set([...shared.allowedGridExchanges, "hyperliquid"]) : shared.allowedGridExchanges
      });
      if (!allowed.ok) {
        return res.status(400).json({ error: "grid_exchange_not_allowed", exchange: allowed.exchange, allowedExchanges: allowed.allowedExchanges });
      }
      const hyperliquidUsage = await shared.resolveGridHyperliquidAccountUsage({
        deps,
        userId: user.id,
        exchangeAccount: { id: account.id, exchange: String(account.exchange ?? "") },
        symbol: String(template.symbol ?? "")
      });
      if (hyperliquidUsage.usesHyperliquid && !allowHyperliquid) {
        return shared.sendGridHyperliquidPilotRequired(
          res,
          pilotAccess,
          account.id,
          hyperliquidUsage.marketDataVenue ?? "hyperliquid"
        );
      }
      if (!shared.isTemplatePolicyImplemented(template)) {
        return res.status(400).json({
          error: "grid_policy_not_implemented",
          reason: "WEIGHTED_NEAR_PRICE and DYNAMIC_BY_PRICE_POSITION are not enabled in v1.4"
        });
      }

      const workspaceMember = await deps.db.workspaceMember.findFirst({
        where: { userId: user.id },
        select: { workspaceId: true }
      });
      if (!workspaceMember?.workspaceId) {
        return res.status(400).json({ error: "workspace_not_found" });
      }

      const templateMarginPolicy = String(template.marginPolicy ?? (template.allowAutoMargin ? "AUTO_ALLOWED" : "MANUAL_ONLY"));
      const requestedMarginMode = parsed.data.marginMode ?? (parsed.data.autoMarginEnabled ? "AUTO" : "MANUAL");
      if (requestedMarginMode === "AUTO" && templateMarginPolicy !== "AUTO_ALLOWED") {
        return res.status(400).json({ error: "grid_template_auto_margin_not_allowed" });
      }
      const autoMarginEnabled = requestedMarginMode === "AUTO";
      const selectedReusableBotVaultId = String(parsed.data.botVaultId ?? "").trim() || null;

      const fixedLeverage = Number(template.leverageDefault ?? template.leverageMin ?? 1);
      if (fixedLeverage < template.leverageMin || fixedLeverage > template.leverageMax) {
        return res.status(400).json({ error: "grid_template_leverage_invalid" });
      }

      const fixedSlippagePct = Number(template.slippageDefaultPct ?? 0.1);
      if (!(fixedSlippagePct >= 0.0001 && fixedSlippagePct <= 5)) {
        return res.status(400).json({ error: "grid_template_slippage_invalid" });
      }
      const useUnifiedHyperVaultCreateFlow =
        executionContext.provider === "hyperliquid"
        && String(account.exchange ?? "").trim().toLowerCase() === "hyperliquid"
        && hyperliquidUsage.usesHyperliquid
        && !selectedReusableBotVaultId;
      if (selectedReusableBotVaultId && !hyperliquidUsage.usesHyperliquid) {
        return res.status(400).json({ error: "grid_bot_vault_requires_hyperliquid" });
      }

      const computed = await deps.computeGridPreviewAndAllocation({
        userId: user.id,
        exchangeAccountId: account.id,
        template,
        autoReservePolicy: template.autoReservePolicy ?? "LIQ_GUARD_MAX_GRID",
        autoReserveFixedGridPct: template.autoReserveFixedGridPct ?? 70,
        autoReserveTargetLiqDistancePct: template.autoReserveTargetLiqDistancePct ?? null,
        autoReserveMaxPreviewIterations: template.autoReserveMaxPreviewIterations ?? 8,
        investUsd: parsed.data.investUsd,
        extraMarginUsd: autoMarginEnabled ? 0 : parsed.data.extraMarginUsd,
        autoMarginEnabled,
        tpPct: parsed.data.tpPct ?? template.tpDefaultPct ?? null,
        slPrice: parsed.data.slPrice ?? template.slDefaultPrice ?? null,
        triggerPrice: parsed.data.triggerPrice ?? null,
        leverage: Math.trunc(fixedLeverage),
        slippagePct: fixedSlippagePct,
        resolveVenueContext: deps.resolveVenueContext
      });

      if (
        String(account.exchange ?? "").trim().toLowerCase() === "hyperliquid"
        && computed.venueContext.constraintSource !== "live"
      ) {
        return res.status(409).json(buildGridLiveVenueConstraintsRequiredErrorResponse({
          computed,
          currentInvestUsd: parsed.data.investUsd,
          symbol: String(template.symbol ?? "")
        }));
      }

      if (computed.allocation.insufficient || computed.allocation.gridInvestUsd + 1e-9 < computed.minInvestmentUSDT) {
        return res.status(400).json(buildGridMinimumInvestmentErrorResponse({
          computed,
          currentInvestUsd: parsed.data.investUsd,
          symbol: String(template.symbol ?? ""),
          marginMode: requestedMarginMode,
          autoMarginEnabled,
          leverage: Math.trunc(fixedLeverage),
        }));
      }

      const requiredBotVaultFundingUsd = shared.toTwoDecimals(
        Number(computed.allocation.gridInvestUsd ?? 0) + Number(computed.allocation.extraMarginUsd ?? 0)
      );
      const reusableFundingRow = selectedReusableBotVaultId
        ? typeof deps.db.botVault?.findFirst === "function"
          ? await deps.db.botVault.findFirst({
              where: {
                id: selectedReusableBotVaultId,
                userId: user.id
              },
              select: {
                availableUsd: true
              }
            }).catch(() => null)
          : null
        : null;
      const reusableRefillUsd = selectedReusableBotVaultId
        ? reusableFundingRow
          ? shared.toTwoDecimals(Math.max(0, requiredBotVaultFundingUsd - Number(reusableFundingRow.availableUsd ?? 0)))
          : 0
        : 0;
      const useReusableRefillFlow = Boolean(selectedReusableBotVaultId && reusableRefillUsd > 0.000001);
      if (useReusableRefillFlow && !deps.onchainActionService) {
        return res.status(503).json({ error: "onchain_action_service_unavailable" });
      }

      const normalizedTemplate = shared.mapGridTemplateRow(template);
      const botName = parsed.data.name?.trim() || `${template.name} (${template.symbol})`;
      const createProvisioningKey = String(parsed.data.idempotencyKey ?? "").trim()
        || `grid_create:${user.id}:${account.id}:${Date.now()}`;
      const createdEntities = await deps.db.$transaction(async (tx: any) => {
        const bot = await tx.bot.create({
          data: {
            userId: user.id,
            workspaceId: workspaceMember.workspaceId,
            exchangeAccountId: account.id,
            name: botName,
            symbol: template.symbol,
            exchange: account.exchange,
            status: "stopped",
            futuresConfig: {
              create: {
                strategyKey: "futures_grid",
                marginMode: "isolated",
                leverage: Math.trunc(fixedLeverage),
                tickMs: 2000,
                paramsJson: {
                  grid: {
                    mode: normalizedTemplate.mode,
                    gridMode: normalizedTemplate.gridMode,
                    lowerPrice: normalizedTemplate.lowerPrice,
                    upperPrice: normalizedTemplate.upperPrice,
                    gridCount: normalizedTemplate.gridCount,
                    crossSideConfig: normalizedTemplate.crossSideConfig ?? null,
                    activeOrderWindowSize: Number.isFinite(Number(normalizedTemplate.activeOrderWindowSize)) ? Math.trunc(Number(normalizedTemplate.activeOrderWindowSize)) : 100,
                    recenterDriftLevels: Number.isFinite(Number(normalizedTemplate.recenterDriftLevels)) ? Math.trunc(Number(normalizedTemplate.recenterDriftLevels)) : 1
                  }
                }
              }
            }
          },
          include: { futuresConfig: true }
        });
        const createdBotId = String(bot.id);

        const createdInstance = await tx.gridBotInstance.create({
          data: {
            workspaceId: workspaceMember.workspaceId,
            userId: user.id,
            exchangeAccountId: account.id,
            templateId: template.id,
            botId: bot.id,
            state: "created",
            archivedAt: null,
            archivedReason: null,
            allocationMode: template.allocationMode ?? "EQUAL_NOTIONAL_PER_GRID",
            budgetSplitPolicy: template.budgetSplitPolicy ?? "FIXED_50_50",
            longBudgetPct: Number.isFinite(Number(template.longBudgetPct)) ? Number(template.longBudgetPct) : 50,
            shortBudgetPct: Number.isFinite(Number(template.shortBudgetPct)) ? Number(template.shortBudgetPct) : 50,
            marginPolicy: templateMarginPolicy === "AUTO_ALLOWED" ? "AUTO_ALLOWED" : "MANUAL_ONLY",
            marginMode: requestedMarginMode,
            autoMarginMaxUSDT: template.autoMarginMaxUSDT ?? null,
            autoMarginTriggerType: template.autoMarginTriggerType ?? null,
            autoMarginTriggerValue: template.autoMarginTriggerValue ?? null,
            autoMarginStepUSDT: template.autoMarginStepUSDT ?? null,
            autoMarginCooldownSec: template.autoMarginCooldownSec ?? null,
            autoReservePolicy: template.autoReservePolicy ?? "LIQ_GUARD_MAX_GRID",
            autoReserveFixedGridPct: Number.isFinite(Number(template.autoReserveFixedGridPct)) ? Number(template.autoReserveFixedGridPct) : 70,
            autoReserveTargetLiqDistancePct: Number.isFinite(Number(template.autoReserveTargetLiqDistancePct)) ? Number(template.autoReserveTargetLiqDistancePct) : null,
            autoReserveMaxPreviewIterations: Number.isFinite(Number(template.autoReserveMaxPreviewIterations)) ? Math.trunc(Number(template.autoReserveMaxPreviewIterations)) : 8,
            initialSeedEnabled: typeof template.initialSeedEnabled === "boolean" ? template.initialSeedEnabled : true,
            initialSeedPct: Number.isFinite(Number(template.initialSeedPct)) ? Number(template.initialSeedPct) : 30,
            activeOrderWindowSize: Number.isFinite(Number(template.activeOrderWindowSize)) ? Math.trunc(Number(template.activeOrderWindowSize)) : 100,
            recenterDriftLevels: Number.isFinite(Number(template.recenterDriftLevels)) ? Math.trunc(Number(template.recenterDriftLevels)) : 1,
            autoMarginUsedUSDT: 0,
            investUsd: computed.allocation.gridInvestUsd,
            leverage: Math.trunc(fixedLeverage),
            extraMarginUsd: computed.allocation.extraMarginUsd,
            triggerPrice: parsed.data.triggerPrice ?? null,
            slippagePct: fixedSlippagePct,
            tpPct: parsed.data.tpPct ?? template.tpDefaultPct ?? null,
            slPrice: parsed.data.slPrice ?? template.slDefaultPrice ?? null,
            autoMarginEnabled,
            stateJson: useUnifiedHyperVaultCreateFlow || useReusableRefillFlow
              ? {
                  provisioning: {
                    phase: useReusableRefillFlow ? "pending_reserve_signature" : "pending_signature",
                    reason: "awaiting_wallet_signature",
                    idempotencyKey: createProvisioningKey,
                    startedAt: new Date().toISOString()
                  }
                }
              : {},
            metricsJson: {}
          }
        });
        const createdInstanceId = String(createdInstance.id);

        const botVault = await deps.vaultService.ensureBotVaultForGridInstance({
          tx,
          userId: user.id,
          gridInstanceId: createdInstance.id,
          botVaultId: selectedReusableBotVaultId ?? undefined,
          allocatedUsd: Number(createdInstance.investUsd ?? 0) + Number(createdInstance.extraMarginUsd ?? 0),
          deferReservation: useUnifiedHyperVaultCreateFlow || useReusableRefillFlow,
          idempotencyKey: `${createProvisioningKey}:bot_vault`,
          metadata: useUnifiedHyperVaultCreateFlow
            ? {
                sourceType: "grid_instance_create_pending_onchain",
                provisioningPhase: "pending_signature",
                createIdempotencyKey: createProvisioningKey
              }
            : useReusableRefillFlow && selectedReusableBotVaultId
              ? {
                  sourceType: "grid_instance_reuse_pending_refill",
                  reusedBotVaultId: selectedReusableBotVaultId,
                  provisioningPhase: "pending_reserve_signature",
                  refillUsd: reusableRefillUsd
                }
            : selectedReusableBotVaultId
              ? {
                  sourceType: "grid_instance_reuse",
                  reusedBotVaultId: selectedReusableBotVaultId
                }
              : undefined
        });
        const createdBotVaultId = String(botVault.id);
        const reusedBotVaultBinding = (
          botVault
          && typeof botVault === "object"
          && !Array.isArray(botVault)
          && botVault.__reuseBinding
          && typeof botVault.__reuseBinding === "object"
          && !Array.isArray(botVault.__reuseBinding)
        )
          ? botVault.__reuseBinding as ReusedBotVaultBinding
          : null;
        return {
          createdInstanceId,
          createdBotId,
          createdBotVaultId,
          reusedBotVaultBinding
        };
      });
      const {
        createdInstanceId,
        createdBotId,
        createdBotVaultId,
        reusedBotVaultBinding
      } = createdEntities;

      if (!createdInstanceId || !createdBotId || !createdBotVaultId) {
        return res.status(500).json({ error: "grid_instance_create_failed", reason: "instance_not_found_post_create" });
      }

      if (useUnifiedHyperVaultCreateFlow) {
        if (!deps.onchainActionService) {
          return res.status(503).json({ error: "onchain_action_service_unavailable" });
        }
        const totalAllocationUsd = Number((
          Number(computed.allocation.gridInvestUsd ?? 0)
          + Number(computed.allocation.extraMarginUsd ?? 0)
          + HYPERVAULT_CREATE_FEE_USD
        ).toFixed(4));
        try {
          const built = await deps.onchainActionService.buildCreateBotVault({
            userId: user.id,
            botVaultId: createdBotVaultId,
            allocationUsd: totalAllocationUsd,
            actionKey: `grid:create_bot_vault:${createdInstanceId}:${createProvisioningKey}`
          });
          await deps.db.$transaction(async (tx: any) => {
            const currentBotVault = await tx.botVault.findUnique({
              where: { id: createdBotVaultId },
              select: { executionMetadata: true }
            });
            await tx.gridBotInstance.update({
              where: { id: createdInstanceId },
              data: {
                stateJson: {
                  provisioning: {
                    phase: "pending_signature",
                    reason: "awaiting_wallet_signature",
                    idempotencyKey: createProvisioningKey,
                    pendingActionId: String(built.action.id),
                    pendingActionStatus: String(built.action.status ?? "prepared"),
                    startedAt: new Date().toISOString()
                  }
                }
              }
            });
            await tx.botVault.update({
              where: { id: createdBotVaultId },
              data: {
                executionMetadata: {
                  ...(((currentBotVault?.executionMetadata && typeof currentBotVault.executionMetadata === "object" && !Array.isArray(currentBotVault.executionMetadata))
                    ? currentBotVault.executionMetadata
                    : {}) as Record<string, unknown>),
                  provisioning: {
                    phase: "pending_signature",
                    idempotencyKey: createProvisioningKey,
                    allocationUsd: totalAllocationUsd,
                    pendingActionId: String(built.action.id),
                    pendingActionStatus: String(built.action.status ?? "prepared"),
                    lastAction: "createBotVaultPrepared"
                  }
                }
              }
            });
          });

          const instance = await deps.loadGridInstanceForUser({
            db: deps.db,
            userId: user.id,
            instanceId: createdInstanceId
          });
          if (!instance) {
            return res.status(500).json({ error: "grid_instance_create_failed", reason: "instance_not_found_post_build" });
          }
          const mapped = shared.mapGridInstanceRow(instance);
          return res.status(201).json({
            instance: mapped,
            botVault: mapped.botVault ?? null,
            provisioningStatus: mapped.provisioningStatus ?? {
              phase: "pending_signature",
              reason: "awaiting_wallet_signature",
              pendingActionId: String(built.action.id),
              walletSignatureRequired: true
            },
            onchainAction: built.action,
            txRequest: built.txRequest,
            mode: built.mode
          });
        } catch (buildError) {
          await deps.db.$transaction(async (tx: any) => {
            await tx.onchainAction.deleteMany({ where: { botVaultId: createdBotVaultId } }).catch(() => ({ count: 0 }));
            await tx.botVault.deleteMany({ where: { id: createdBotVaultId } });
            await tx.gridBotInstance.deleteMany({ where: { id: createdInstanceId } });
            await tx.botRuntime.deleteMany({ where: { botId: createdBotId } });
            await tx.futuresBotConfig.deleteMany({ where: { botId: createdBotId } });
            await tx.bot.deleteMany({ where: { id: createdBotId } });
          }).catch(() => undefined);
          return res.status(500).json({
            error: "grid_instance_create_failed",
            reason: String(buildError)
          });
        }
      }

      if (useReusableRefillFlow) {
        if (!deps.onchainActionService) {
          return res.status(503).json({ error: "onchain_action_service_unavailable" });
        }
        try {
          const built = await deps.onchainActionService.buildReserveForBotVault({
            userId: user.id,
            botVaultId: createdBotVaultId,
            amountUsd: reusableRefillUsd,
            actionKey: `grid:refill_reused_bot_vault:${createdInstanceId}:${createProvisioningKey}`
          });
          await deps.db.$transaction(async (tx: any) => {
            const currentBotVault = await tx.botVault.findUnique({
              where: { id: createdBotVaultId },
              select: { executionMetadata: true }
            });
            const currentMetadata = currentBotVault?.executionMetadata && typeof currentBotVault.executionMetadata === "object" && !Array.isArray(currentBotVault.executionMetadata)
              ? currentBotVault.executionMetadata as Record<string, unknown>
              : {};
            await tx.gridBotInstance.update({
              where: { id: createdInstanceId },
              data: {
                stateJson: {
                  provisioning: {
                    phase: "pending_reserve_signature",
                    reason: "awaiting_wallet_signature",
                    idempotencyKey: createProvisioningKey,
                    pendingActionId: String(built.action.id),
                    pendingActionStatus: String(built.action.status ?? "prepared"),
                    startedAt: new Date().toISOString()
                  }
                }
              }
            });
            await tx.botVault.update({
              where: { id: createdBotVaultId },
              data: {
                status: "ACTIVE",
                executionStatus: "created",
                fundingStatus: "hyper_evm_funding_requested",
                executionMetadata: {
                  ...currentMetadata,
                  provisioning: {
                    phase: "pending_reserve_signature",
                    idempotencyKey: createProvisioningKey,
                    allocationUsd: reusableRefillUsd,
                    pendingActionId: String(built.action.id),
                    pendingActionStatus: String(built.action.status ?? "prepared"),
                    lastAction: "reusedBotVaultRefillPrepared"
                  }
                }
              }
            });
          });

          const instance = await deps.loadGridInstanceForUser({
            db: deps.db,
            userId: user.id,
            instanceId: createdInstanceId
          });
          if (!instance) {
            return res.status(500).json({ error: "grid_instance_create_failed", reason: "instance_not_found_post_refill_build" });
          }
          const mapped = shared.mapGridInstanceRow(instance);
          return res.status(201).json({
            instance: mapped,
            botVault: mapped.botVault ?? null,
            provisioningStatus: mapped.provisioningStatus ?? {
              phase: "pending_reserve_signature",
              reason: "awaiting_wallet_signature",
              pendingActionId: String(built.action.id),
              walletSignatureRequired: true
            },
            onchainAction: built.action,
            txRequest: built.txRequest,
            mode: built.mode
          });
        } catch (buildError) {
          try {
            if (reusedBotVaultBinding) {
              await deps.db.botVault.update({
                where: { id: String(reusedBotVaultBinding.botVaultId) },
                data: {
                  gridInstanceId: reusedBotVaultBinding.previousGridInstanceId
                    ? String(reusedBotVaultBinding.previousGridInstanceId)
                    : null,
                  botId: reusedBotVaultBinding.previousBotId
                    ? String(reusedBotVaultBinding.previousBotId)
                    : null,
                  templateId: reusedBotVaultBinding.previousTemplateId
                    ? String(reusedBotVaultBinding.previousTemplateId)
                    : "legacy_grid_default",
                  status: String(reusedBotVaultBinding.previousStatus ?? "ACTIVE"),
                  executionStatus: reusedBotVaultBinding.previousExecutionStatus == null
                    ? null
                    : String(reusedBotVaultBinding.previousExecutionStatus),
                  executionLastError: reusedBotVaultBinding.previousExecutionLastError == null
                    ? null
                    : String(reusedBotVaultBinding.previousExecutionLastError),
                  executionLastErrorAt: reusedBotVaultBinding.previousExecutionLastErrorAt instanceof Date
                    ? reusedBotVaultBinding.previousExecutionLastErrorAt
                    : reusedBotVaultBinding.previousExecutionLastErrorAt == null
                      ? null
                      : new Date(String(reusedBotVaultBinding.previousExecutionLastErrorAt)),
                  executionMetadata: reusedBotVaultBinding.previousExecutionMetadata ?? null
                }
              });
            }
            await deps.db.$transaction(async (tx: any) => {
              await tx.onchainAction.deleteMany({ where: { botVaultId: createdBotVaultId, status: "prepared" } }).catch(() => ({ count: 0 }));
              await tx.gridBotInstance.deleteMany({ where: { id: createdInstanceId } });
              await tx.botRuntime.deleteMany({ where: { botId: createdBotId } }).catch(() => ({ count: 0 }));
              await tx.futuresBotConfig.deleteMany({ where: { botId: createdBotId } }).catch(() => ({ count: 0 }));
              await tx.bot.deleteMany({ where: { id: createdBotId } }).catch(() => ({ count: 0 }));
            });
          } catch {
            // best effort rollback
          }
          return res.status(500).json({
            error: "grid_instance_create_failed",
            reason: String(buildError)
          });
        }
      }

      try {
        const row = await deps.loadGridInstanceForUser({
          db: deps.db,
          userId: user.id,
          instanceId: createdInstanceId
        });
        if (!row) {
          throw new Error("created_instance_not_found");
        }
        await deps.gridLifecycle.startGridInstanceNow({
          row,
          userId: user.id,
          allowedExchanges: allowHyperliquid ? new Set([...shared.allowedGridExchanges, "hyperliquid"]) : shared.allowedGridExchanges
        });
      } catch (startError) {
        try {
          if (reusedBotVaultBinding) {
            await deps.db.botVault.update({
              where: { id: String(reusedBotVaultBinding.botVaultId) },
              data: {
                gridInstanceId: reusedBotVaultBinding.previousGridInstanceId
                  ? String(reusedBotVaultBinding.previousGridInstanceId)
                  : null,
                botId: reusedBotVaultBinding.previousBotId
                  ? String(reusedBotVaultBinding.previousBotId)
                  : null,
                templateId: reusedBotVaultBinding.previousTemplateId
                  ? String(reusedBotVaultBinding.previousTemplateId)
                  : "legacy_grid_default",
                status: String(reusedBotVaultBinding.previousStatus ?? "ACTIVE"),
                executionStatus: reusedBotVaultBinding.previousExecutionStatus == null
                  ? null
                  : String(reusedBotVaultBinding.previousExecutionStatus),
                executionLastError: reusedBotVaultBinding.previousExecutionLastError == null
                  ? null
                  : String(reusedBotVaultBinding.previousExecutionLastError),
                executionLastErrorAt: reusedBotVaultBinding.previousExecutionLastErrorAt instanceof Date
                  ? reusedBotVaultBinding.previousExecutionLastErrorAt
                  : reusedBotVaultBinding.previousExecutionLastErrorAt == null
                    ? null
                    : new Date(String(reusedBotVaultBinding.previousExecutionLastErrorAt)),
                executionMetadata: reusedBotVaultBinding.previousExecutionMetadata ?? null
              }
            });
          } else {
            await deps.vaultService.setBotVaultCloseOnlyForGridInstance({
              userId: user.id,
              gridInstanceId: createdInstanceId
            });
            await deps.vaultService.closeBotVaultForGridInstance({
              userId: user.id,
              gridInstanceId: createdInstanceId,
              idempotencyKey: `grid_instance:${createdInstanceId}:rollback_create_start`,
              forceClose: true,
              metadata: { sourceType: "grid_instance_create_rollback" }
            });
          }
        } catch {
          // best effort
        }
        await deps.db.$transaction(async (tx: any) => {
          await tx.botRuntime.deleteMany({ where: { botId: createdBotId } });
          await tx.futuresBotConfig.deleteMany({ where: { botId: createdBotId } });
          await tx.bot.deleteMany({ where: { id: createdBotId } });
        });
        if (startError instanceof deps.ManualTradingError) {
          const manualStartError = startError as any;
          return res.status(manualStartError.status).json({
            error: "grid_instance_create_rollback_start_failed",
            startError: manualStartError.code,
            reason: manualStartError.message
          });
        }
        const mappedStartRisk = shared.mapRiskErrorToHttp(startError);
        if (mappedStartRisk) {
          return res.status(mappedStartRisk.status).json({
            error: "grid_instance_create_rollback_start_failed",
            startError: mappedStartRisk.code,
            reason: mappedStartRisk.reason
          });
        }
        return res.status(500).json({
          error: "grid_instance_create_rollback_start_failed",
          reason: String(startError)
        });
      }

      const instance = await deps.loadGridInstanceForUser({
        db: deps.db,
        userId: user.id,
        instanceId: createdInstanceId
      });
      if (!instance) {
        return res.status(500).json({ error: "grid_instance_create_failed", reason: "instance_not_found_post_start" });
      }
      return res.status(201).json(shared.mapGridInstanceRow(instance));
    } catch (error) {
      if (error instanceof deps.ManualTradingError) {
        const manualError = error as any;
        if (String(manualError.code ?? "") === "grid_instance_end_pending_onchain_signature") {
          const botVault = typeof deps.vaultService?.getBotVaultByGridInstance === "function"
            ? await deps.vaultService.getBotVaultByGridInstance({
                userId: user.id,
                gridInstanceId: req.params.id
              }).catch(() => null)
            : null;
          return res.status(manualError.status ?? 409).json({
            error: manualError.code,
            reason: manualError.message,
            botVault
          });
        }
        return res.status(manualError.status ?? 400).json({
          error: manualError.code ?? "grid_instance_end_failed",
          reason: manualError.message
        });
      }
      const mappedRisk = shared.mapRiskErrorToHttp(error);
      if (mappedRisk) {
        if (mappedRisk.code === "grid_instance_end_pending_onchain_signature") {
          const botVault = typeof deps.vaultService?.getBotVaultByGridInstance === "function"
            ? await deps.vaultService.getBotVaultByGridInstance({
                userId: user.id,
                gridInstanceId: req.params.id
              }).catch(() => null)
            : null;
          return res.status(mappedRisk.status).json({
            error: mappedRisk.code,
            reason: mappedRisk.reason,
            botVault
          });
        }
        return res.status(mappedRisk.status).json({
          error: mappedRisk.code,
          reason: mappedRisk.reason
        });
      }
      const reason = String(error ?? "");
      if (reason.includes("bot_vault_not_found")) {
        return res.status(404).json({ error: "bot_vault_not_found" });
      }
      if (reason.includes("bot_vault_not_reusable")) {
        return res.status(409).json({
          error: "grid_bot_vault_not_reusable",
          reason
        });
      }
      if (shared.isMissingTableError(error)) return res.status(503).json({ error: "grid_schema_not_ready" });
      return res.status(500).json({ error: "grid_instance_create_failed", reason });
    }
  });

  app.get("/grid/instances", requireAuth, async (req, res) => {
    if (!(await shared.requireGridFeatureEnabledOrRespond(res))) return;
    if (!(await shared.requireGridCapabilityOrRespond(res, deps))) return;
    const parsed = shared.gridInstanceListQuerySchema.safeParse(req.query ?? {});
    if (!parsed.success) {
      return res.status(400).json({ error: "invalid_query", details: parsed.error.flatten() });
    }

    const user = getUserFromLocals(res);
    try {
      await cleanupStalePendingProvisioningForUser(user.id).catch(() => undefined);
      const currentPilotAccess = await deps.resolveGridHyperliquidPilotAccess(deps.db, {
        userId: user.id,
        email: user.email ?? null
      }).catch(() => null);
      const rows = await deps.db.gridBotInstance.findMany({
        where: {
          userId: user.id,
          ...(parsed.data.exchangeAccountId ? { exchangeAccountId: parsed.data.exchangeAccountId } : {})
        },
        include: {
          template: true,
          bot: {
            include: {
              futuresConfig: true,
              exchangeAccount: {
                select: {
                  id: true,
                  exchange: true,
                  label: true
                }
              }
            }
          }
        },
        orderBy: [{ updatedAt: "desc" }]
      });
      const filteredRows = rows.filter((row: any) => {
        const state = String(row.state ?? "");
        if (parsed.data.state) return state === parsed.data.state;
        if (parsed.data.includeArchived === true) return true;
        if (state === "archived") return false;
        return !row.archivedAt;
      });
      const vaultByInstanceId = await deps.loadBotVaultByInstanceIds(deps.db, filteredRows.map((row: any) => row.id));
      const mappedItems = filteredRows.map((row: any) =>
        shared.mapGridInstanceRow({
          ...row,
          botVault: vaultByInstanceId.get(row.id) ?? null
        }, {
          includeProviderMetadataRaw: false,
          currentPilotAccess
        })
      );
      return res.json({
        items: mappedItems.filter((item: Record<string, any>) => !shouldHidePendingSignatureInstance(item))
      });
    } catch (error) {
      if (shared.isMissingTableError(error)) return res.status(503).json({ error: "grid_schema_not_ready" });
      return res.status(500).json({ error: "grid_instance_list_failed", reason: String(error) });
    }
  });

  app.get("/grid/instances/:id", requireAuth, async (req, res) => {
    if (!(await shared.requireGridFeatureEnabledOrRespond(res))) return;
    if (!(await shared.requireGridCapabilityOrRespond(res, deps))) return;
    const user = getUserFromLocals(res);
    try {
      const includeProviderMetadataRaw = await shared.isAdminGridViewer(deps.db, user);
      const currentPilotAccess = await deps.resolveGridHyperliquidPilotAccess(deps.db, {
        userId: user.id,
        email: user.email ?? null
      }).catch(() => null);
      const row = await deps.loadGridInstanceForUser({
        db: deps.db,
        userId: user.id,
        instanceId: req.params.id
      });
      if (!row) return res.status(404).json({ error: "grid_instance_not_found" });
      let executionState: Record<string, unknown> | null = null;
      let executionStateError: string | null = null;
      if (row.botVault?.id) {
        try {
          const state = await deps.vaultService.getExecutionStateForGridInstance({
            userId: user.id,
            gridInstanceId: String(row.id)
          });
          executionState = state ? (state as Record<string, unknown>) : null;
        } catch (error) {
          executionState = null;
          executionStateError = String(error);
        }
      }
      const mapped = shared.mapGridInstanceRow(row, {
        includeProviderMetadataRaw,
        currentPilotAccess
      });
      const mergedBotVault = shared.mergeExecutionStateIntoBotVault(
        mapped.botVault ? (mapped.botVault as Record<string, unknown>) : null,
        executionState,
        includeProviderMetadataRaw
      );
      return res.json({
        ...mapped,
        botVault: mergedBotVault,
        hasOnchainBotVault: shared.deriveHasOnchainBotVault(mergedBotVault),
        pilotStatus: shared.buildGridPilotStatus({
          botVault: mergedBotVault,
          currentPilotAccess
        }),
        executionState,
        executionStateError
      });
    } catch (error) {
      if (shared.isMissingTableError(error)) return res.status(503).json({ error: "grid_schema_not_ready" });
      return res.status(500).json({ error: "grid_instance_get_failed", reason: String(error) });
    }
  });

  app.post("/grid/instances/:id/cancel-provisioning", requireAuth, async (req, res) => {
    if (!(await shared.requireGridFeatureEnabledOrRespond(res))) return;
    if (!(await shared.requireGridCapabilityOrRespond(res, deps))) return;
    const user = getUserFromLocals(res);
    try {
      const result = await cancelPendingProvisioningForInstance({
        userId: user.id,
        instanceId: String(req.params.id ?? ""),
        allowStaleSubmitted: false,
        reason: "user_cancelled_pending_signature"
      });
      if (!result.cleaned) {
        if (result.skippedReason === "grid_instance_not_found") {
          return res.status(404).json({ error: "grid_instance_not_found" });
        }
        return res.status(409).json({
          error: "grid_instance_provisioning_cancel_not_allowed",
          reason: result.skippedReason ?? "not_cancelable"
        });
      }
      return res.json({ ok: true, cleaned: true });
    } catch (error) {
      return res.status(500).json({ error: "grid_instance_provisioning_cancel_failed", reason: String(error) });
    }
  });

  app.post("/grid/instances/:id/start", requireAuth, async (req, res) => {
    if (!(await shared.requireGridFeatureEnabledOrRespond(res))) return;
    if (!(await shared.requireGridCapabilityOrRespond(res, deps))) return;
    const user = getUserFromLocals(res);
    try {
      const row = await deps.loadGridInstanceForUser({ db: deps.db, userId: user.id, instanceId: req.params.id });
      if (!row) return res.status(404).json({ error: "grid_instance_not_found" });
      if (String(row.state ?? "").trim().toLowerCase() === "archived") {
        return res.status(409).json({
          error: "grid_instance_archived_not_restartable",
          id: row.id,
          state: row.state,
          restartable: false
        });
      }
      const allowedExchanges = await resolveCurrentAllowedGridExchanges(user);
      const started = await deps.gridLifecycle.startGridInstanceNow({
        row,
        userId: user.id,
        allowedExchanges
      });
      return res.json({ ok: true, ...started });
    } catch (error) {
      if (error instanceof deps.ManualTradingError) {
        const manualError = error as any;
        if (manualError.code === "grid_exchange_not_allowed") {
          return res.status(manualError.status).json({
            error: manualError.code,
            reason: manualError.message,
            allowedExchanges: [...shared.allowedGridExchanges]
          });
        }
        const vaultErrorPayload = buildGridStartVaultErrorPayload(manualError);
        if (vaultErrorPayload) {
          return res.status(manualError.status).json(vaultErrorPayload);
        }
        return res.status(manualError.status).json({ error: manualError.code, reason: manualError.message });
      }
      const mappedRisk = shared.mapRiskErrorToHttp(error);
      if (mappedRisk) {
        return res.status(mappedRisk.status).json({
          error: mappedRisk.code,
          reason: mappedRisk.reason
        });
      }
      if (shared.isMissingTableError(error)) return res.status(503).json({ error: "grid_schema_not_ready" });
      return res.status(500).json({ error: "grid_instance_start_failed", reason: String(error) });
    }
  });

  app.post("/grid/instances/:id/pause", requireAuth, async (req, res) => {
    if (!(await shared.requireGridFeatureEnabledOrRespond(res))) return;
    if (!(await shared.requireGridCapabilityOrRespond(res, deps))) return;
    const user = getUserFromLocals(res);
    try {
      const row = await deps.loadGridInstanceForUser({ db: deps.db, userId: user.id, instanceId: req.params.id });
      if (!row) return res.status(404).json({ error: "grid_instance_not_found" });
      const state = String(row.state ?? "").trim().toLowerCase();
      if (state === "archived") {
        return res.status(409).json({ error: "grid_instance_archived_not_restartable", state: row.state, restartable: false });
      }
      if (state !== "running") {
        return res.status(409).json({ error: "grid_instance_pause_invalid_state", state: row.state });
      }
      await deps.db.$transaction([
        deps.db.gridBotInstance.update({ where: { id: row.id }, data: { state: "paused" } }),
        deps.db.bot.update({ where: { id: row.botId }, data: { status: "stopped" } })
      ]);
      await deps.vaultService.pauseBotVaultForGridInstance({
        userId: user.id,
        gridInstanceId: String(row.id)
      });
      return res.json({ ok: true, id: row.id, state: "paused", botId: row.botId });
    } catch (error) {
      const mappedRisk = shared.mapRiskErrorToHttp(error);
      if (mappedRisk) {
        return res.status(mappedRisk.status).json({
          error: mappedRisk.code,
          reason: mappedRisk.reason
        });
      }
      if (shared.isMissingTableError(error)) return res.status(503).json({ error: "grid_schema_not_ready" });
      return res.status(500).json({ error: "grid_instance_pause_failed", reason: String(error) });
    }
  });

  app.post("/grid/instances/:id/resume", requireAuth, async (req, res) => {
    if (!(await shared.requireGridFeatureEnabledOrRespond(res))) return;
    if (!(await shared.requireGridCapabilityOrRespond(res, deps))) return;
    const user = getUserFromLocals(res);
    try {
      const row = await deps.loadGridInstanceForUser({ db: deps.db, userId: user.id, instanceId: req.params.id });
      if (!row) return res.status(404).json({ error: "grid_instance_not_found" });
      const state = String(row.state ?? "").trim().toLowerCase();
      if (state === "archived") {
        return res.status(409).json({ error: "grid_instance_archived_not_restartable", state: row.state, restartable: false });
      }
      if (state !== "paused" && state !== "stopped" && state !== "created" && state !== "error") {
        return res.status(409).json({ error: "grid_instance_resume_invalid_state", state: row.state });
      }
      const allowedExchanges = await resolveCurrentAllowedGridExchanges(user);
      const started = await deps.gridLifecycle.startGridInstanceNow({
        row,
        userId: user.id,
        allowedExchanges
      });
      return res.json({ ok: true, ...started });
    } catch (error) {
      if (error instanceof deps.ManualTradingError) {
        const manualError = error as any;
        if (manualError.code === "grid_exchange_not_allowed") {
          return res.status(manualError.status).json({
            error: manualError.code,
            reason: manualError.message,
            allowedExchanges: [...shared.allowedGridExchanges]
          });
        }
        const vaultErrorPayload = buildGridStartVaultErrorPayload(manualError);
        if (vaultErrorPayload) {
          return res.status(manualError.status).json(vaultErrorPayload);
        }
        return res.status(manualError.status).json({ error: manualError.code, reason: manualError.message });
      }
      const mappedRisk = shared.mapRiskErrorToHttp(error);
      if (mappedRisk) {
        return res.status(mappedRisk.status).json({
          error: mappedRisk.code,
          reason: mappedRisk.reason
        });
      }
      if (shared.isMissingTableError(error)) return res.status(503).json({ error: "grid_schema_not_ready" });
      return res.status(500).json({ error: "grid_instance_resume_failed", reason: String(error) });
    }
  });

  app.post("/grid/instances/:id/stop", requireAuth, async (req, res) => {
    if (!(await shared.requireGridFeatureEnabledOrRespond(res))) return;
    if (!(await shared.requireGridCapabilityOrRespond(res, deps))) return;
    const user = getUserFromLocals(res);
    try {
      const row = await deps.loadGridInstanceForUser({ db: deps.db, userId: user.id, instanceId: req.params.id });
      if (!row) return res.status(404).json({ error: "grid_instance_not_found" });
      const stopped = await deps.gridLifecycle.stopGridInstance({
        row,
        userId: user.id
      });
      return res.json({ ok: true, ...stopped });
    } catch (error) {
      const mappedRisk = shared.mapRiskErrorToHttp(error);
      if (mappedRisk) {
        return res.status(mappedRisk.status).json({
          error: mappedRisk.code,
          reason: mappedRisk.reason
        });
      }
      if (String(error).includes("execution_positions_still_open")) {
        return res.status(409).json({
          error: "execution_positions_still_open",
          reason: String(error)
        });
      }
      if (shared.isMissingTableError(error)) return res.status(503).json({ error: "grid_schema_not_ready" });
      return res.status(500).json({ error: "grid_instance_stop_failed", reason: String(error) });
    }
  });

  app.post("/grid/instances/:id/end", requireAuth, async (req, res) => {
    if (!(await shared.requireGridFeatureEnabledOrRespond(res))) return;
    if (!(await shared.requireGridCapabilityOrRespond(res, deps))) return;
    const user = getUserFromLocals(res);
    try {
      const row = await deps.loadGridInstanceForUser({ db: deps.db, userId: user.id, instanceId: req.params.id });
      if (!row) return res.status(404).json({ error: "grid_instance_not_found" });
      const archived = await deps.gridLifecycle.endGridInstance({
        row,
        userId: user.id,
        reason: "manual_end",
        closeSourceType: "grid_instance_end_final"
      });
      return res.json({ ok: true, ...archived });
    } catch (error) {
      const mappedRisk = shared.mapRiskErrorToHttp(error);
      if (mappedRisk) {
        return res.status(mappedRisk.status).json({
          error: mappedRisk.code,
          reason: mappedRisk.reason
        });
      }
      if (String(error).includes("execution_positions_still_open")) {
        return res.status(409).json({
          error: "execution_positions_still_open",
          reason: String(error)
        });
      }
      if (String(error).includes("bot_vault_not_flat")) {
        return res.status(409).json({
          error: "bot_vault_not_flat",
          reason: String(error)
        });
      }
      if (shared.isMissingTableError(error)) return res.status(503).json({ error: "grid_schema_not_ready" });
      return res.status(500).json({ error: "grid_instance_end_failed", reason: String(error) });
    }
  });

  app.put("/grid/instances/:id/risk", requireAuth, async (req, res) => {
    if (!(await shared.requireGridFeatureEnabledOrRespond(res))) return;
    if (!(await shared.requireGridCapabilityOrRespond(res, deps))) return;
    const parsed = shared.gridInstanceRiskUpdateSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return res.status(400).json({ error: "invalid_payload", details: parsed.error.flatten() });
    }

    const user = getUserFromLocals(res);
    try {
      const row = await deps.loadGridInstanceForUser({ db: deps.db, userId: user.id, instanceId: req.params.id });
      if (!row) return res.status(404).json({ error: "grid_instance_not_found" });
      const templateMarginPolicy = String(row.template.marginPolicy ?? (row.template.allowAutoMargin ? "AUTO_ALLOWED" : "MANUAL_ONLY"));
      const currentMarginMode = String(row.marginMode ?? (row.autoMarginEnabled ? "AUTO" : "MANUAL")) === "AUTO" ? "AUTO" : "MANUAL";
      const requestedMarginMode = parsed.data.marginMode
        ?? (parsed.data.autoMarginEnabled !== undefined ? (parsed.data.autoMarginEnabled ? "AUTO" : "MANUAL") : currentMarginMode);
      const nextAutoMarginEnabled = requestedMarginMode === "AUTO";
      if (nextAutoMarginEnabled && templateMarginPolicy !== "AUTO_ALLOWED") {
        return res.status(400).json({ error: "grid_template_auto_margin_not_allowed" });
      }

      const updateData: Record<string, unknown> = {
        ...(parsed.data.tpPct !== undefined ? { tpPct: parsed.data.tpPct } : {}),
        ...(parsed.data.slPrice !== undefined ? { slPrice: parsed.data.slPrice } : {}),
        ...(parsed.data.autoMarginEnabled !== undefined ? { autoMarginEnabled: parsed.data.autoMarginEnabled } : {}),
        ...(parsed.data.marginMode !== undefined ? { marginMode: parsed.data.marginMode } : {}),
        marginMode: requestedMarginMode,
        autoMarginEnabled: nextAutoMarginEnabled
      };

      if (nextAutoMarginEnabled && currentMarginMode !== "AUTO") {
        const totalBudget = Number(row.investUsd ?? 0) + Number(row.extraMarginUsd ?? 0);
        const computed = await deps.computeGridPreviewAndAllocation({
          userId: user.id,
          exchangeAccountId: row.exchangeAccountId,
          template: row.template,
          autoReservePolicy: row.autoReservePolicy ?? row.template.autoReservePolicy ?? "LIQ_GUARD_MAX_GRID",
          autoReserveFixedGridPct: row.autoReserveFixedGridPct ?? row.template.autoReserveFixedGridPct ?? 70,
          autoReserveTargetLiqDistancePct: row.autoReserveTargetLiqDistancePct ?? row.template.autoReserveTargetLiqDistancePct ?? null,
          autoReserveMaxPreviewIterations: row.autoReserveMaxPreviewIterations ?? row.template.autoReserveMaxPreviewIterations ?? 8,
          activeOrderWindowSize: row.activeOrderWindowSize ?? row.template.activeOrderWindowSize ?? 100,
          recenterDriftLevels: row.recenterDriftLevels ?? row.template.recenterDriftLevels ?? 1,
          investUsd: totalBudget,
          extraMarginUsd: 0,
          autoMarginEnabled: true,
          tpPct: parsed.data.tpPct ?? row.tpPct ?? row.template.tpDefaultPct ?? null,
          slPrice: parsed.data.slPrice ?? row.slPrice ?? row.template.slDefaultPrice ?? null,
          triggerPrice: row.triggerPrice ?? null,
          leverage: row.leverage,
          slippagePct: row.slippagePct,
          resolveVenueContext: deps.resolveVenueContext
        });
        if (computed.allocation.insufficient || computed.allocation.gridInvestUsd + 1e-9 < computed.minInvestmentUSDT) {
          return res.status(400).json(buildGridMinimumInvestmentErrorResponse({
            computed,
            currentInvestUsd: totalBudget,
            symbol: String(row.template.symbol ?? ""),
            marginMode: requestedMarginMode,
            autoMarginEnabled: nextAutoMarginEnabled,
            leverage: Number(row.leverage ?? 0),
          }));
        }
        updateData.investUsd = computed.allocation.gridInvestUsd;
        updateData.extraMarginUsd = computed.allocation.extraMarginUsd;
      }

      const updated = await deps.db.gridBotInstance.update({
        where: { id: row.id },
        data: updateData,
        include: {
          template: true,
          bot: {
            include: {
              futuresConfig: true,
              exchangeAccount: {
                select: {
                  id: true,
                  exchange: true,
                  label: true
                }
              }
            }
          }
        }
      });
      return res.json(shared.mapGridInstanceRow(updated));
    } catch (error) {
      if (shared.isMissingTableError(error)) return res.status(503).json({ error: "grid_schema_not_ready" });
      return res.status(500).json({ error: "grid_instance_risk_update_failed", reason: String(error) });
    }
  });

  function isBotVaultV3Instance(row: any): boolean {
    return String(row?.botVault?.vaultModel ?? "").trim().toLowerCase() === "bot_vault_v3";
  }

  function readGridInstanceLiqEstimate(row: any): number | null {
    const metrics = row?.metricsJson && typeof row.metricsJson === "object" && !Array.isArray(row.metricsJson)
      ? row.metricsJson as Record<string, unknown>
      : {};
    const value = Number(metrics.liqEstimateLong ?? metrics.liqEstimateShort ?? NaN);
    return Number.isFinite(value) ? value : null;
  }

  function asRecord(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    return value as Record<string, unknown>;
  }

  function toNullableString(value: unknown): string | null {
    const raw = String(value ?? "").trim();
    return raw ? raw : null;
  }

  function roundUsd(value: unknown): number {
    return shared.toTwoDecimals(Number(value ?? 0));
  }

  function hasUsdDrift(left: unknown, right: unknown, epsilon = 0.000001): boolean {
    return Math.abs(Number(left ?? 0) - Number(right ?? 0)) > epsilon;
  }

  function buildGridMarginActionRequestKey(params: {
    actionKey: "marginAddFinalize" | "marginRemove" | "marginAddTopUp";
    rowId: string;
    botVaultId?: string | null;
    requestedAmountUsd: number;
    transferAmountUsd: number;
    currentInvestUsd: number;
    currentExtraMarginUsd: number;
    nextInvestUsd: number;
    nextExtraMarginUsd: number;
    marginMode: string;
  }): string {
    const payload = JSON.stringify({
      actionKey: params.actionKey,
      rowId: params.rowId,
      botVaultId: params.botVaultId ?? null,
      requestedAmountUsd: roundUsd(params.requestedAmountUsd),
      transferAmountUsd: roundUsd(params.transferAmountUsd),
      currentInvestUsd: roundUsd(params.currentInvestUsd),
      currentExtraMarginUsd: roundUsd(params.currentExtraMarginUsd),
      nextInvestUsd: roundUsd(params.nextInvestUsd),
      nextExtraMarginUsd: roundUsd(params.nextExtraMarginUsd),
      marginMode: String(params.marginMode ?? "").trim().toUpperCase()
    });
    return crypto.createHash("sha256").update(payload).digest("hex").slice(0, 24);
  }

  function readGridQuickActionState(stateJson: unknown, actionKey: "marginAddFinalize" | "marginRemove"): Record<string, unknown> {
    return asRecord(asRecord(asRecord(stateJson).quickActions)[actionKey]);
  }

  function hasPendingGridQuickAction(actionState: Record<string, unknown>): boolean {
    const stage = String(actionState.stage ?? "").trim().toLowerCase();
    return stage === "pending_external" || stage === "external_confirmed";
  }

  function findPendingGridQuickAction(stateJson: unknown): {
    actionKey: "marginAddFinalize" | "marginRemove";
    actionState: Record<string, unknown>;
  } | null {
    for (const actionKey of ["marginAddFinalize", "marginRemove"] as const) {
      const actionState = readGridQuickActionState(stateJson, actionKey);
      if (hasPendingGridQuickAction(actionState)) {
        return { actionKey, actionState };
      }
    }
    return null;
  }

  function buildGridQuickActionStateJson(params: {
    stateJson: unknown;
    actionKey: "marginAddFinalize" | "marginRemove";
    actionState: Record<string, unknown>;
  }): Record<string, unknown> {
    const base = asRecord(params.stateJson);
    const quickActions = asRecord(base.quickActions);
    return {
      ...base,
      quickActions: {
        ...quickActions,
        [params.actionKey]: params.actionState
      }
    };
  }

  function buildGridMarginActionConflictPayload(params: {
    actionKey: "marginAddFinalize" | "marginRemove";
    actionState: Record<string, unknown>;
  }) {
    return {
      error: "grid_instance_margin_action_recovery_required",
      reason: `pending_margin_action:${params.actionKey}:${String(params.actionState.stage ?? "unknown")}`,
      pendingAction: {
        actionKey: params.actionKey,
        stage: String(params.actionState.stage ?? "unknown"),
        requestKey: toNullableString(params.actionState.requestKey),
        requestedAmountUsd: Number(params.actionState.requestedAmountUsd ?? 0),
        transferAmountUsd: Number(params.actionState.transferAmountUsd ?? 0),
        updatedAt: toNullableString(params.actionState.updatedAt)
      }
    };
  }

  function hasStoredMarginAddFinalization(row: any, transferAmountUsd: number): boolean {
    const finalization = asRecord(asRecord(row?.botVault?.executionMetadata).marginAddFinalization);
    if (!Object.keys(finalization).length) return false;
    const storedAmountUsd = Number(
      finalization.transferToPerpAmountUsd
      ?? finalization.requestedAmountUsd
      ?? NaN
    );
    if (!Number.isFinite(storedAmountUsd) || hasUsdDrift(storedAmountUsd, transferAmountUsd)) return false;
    return Boolean(
      toNullableString(finalization.updatedAt)
      || toNullableString(finalization.depositTxHash)
      || toNullableString(finalization.transferTxHash)
      || toNullableString(finalization.verificationState)
      || toNullableString(finalization.transferResultStatus)
    );
  }

  function hasStoredReduceMarginFinalization(row: any, transferAmountUsd: number): boolean {
    const finalization = asRecord(asRecord(row?.botVault?.executionMetadata).reduceMarginFinalization);
    if (!Object.keys(finalization).length) return false;
    const storedAmountUsd = Number(finalization.releasedAmountUsd ?? NaN);
    if (!Number.isFinite(storedAmountUsd) || hasUsdDrift(storedAmountUsd, transferAmountUsd)) return false;
    return Boolean(
      toNullableString(finalization.updatedAt)
      || toNullableString(finalization.transferTxHash)
      || toNullableString(finalization.verificationState)
      || toNullableString(finalization.transferResultStatus)
      || toNullableString(finalization.stage)
    );
  }

  function buildMarginActionState(params: {
    requestKey: string;
    requestedAmountUsd: number;
    transferAmountUsd: number;
    updateData: { investUsd: number; extraMarginUsd: number };
    stage: "pending_external" | "external_confirmed" | "applied";
    source: "fresh_call" | "grid_state_resume" | "bot_vault_resume";
    result?: unknown;
  }): Record<string, unknown> {
    const now = new Date().toISOString();
    return {
      requestKey: params.requestKey,
      requestedAmountUsd: roundUsd(params.requestedAmountUsd),
      transferAmountUsd: roundUsd(params.transferAmountUsd),
      nextInvestUsd: roundUsd(params.updateData.investUsd),
      nextExtraMarginUsd: roundUsd(params.updateData.extraMarginUsd),
      stage: params.stage,
      source: params.source,
      result: params.result ?? null,
      updatedAt: now,
      externalConfirmedAt: params.stage === "pending_external" ? null : now,
      appliedAt: params.stage === "applied" ? now : null
    };
  }

  function isGridMarginPreviewDependencyError(error: unknown): boolean {
    const message = error instanceof Error ? String(error.message ?? "") : String(error ?? "");
    const normalized = message.toLowerCase();
    return normalized.includes("fetch failed")
      || normalized.includes("timeout")
      || normalized.includes("timed out")
      || normalized.includes("network")
      || normalized.includes("econn")
      || normalized.includes("socket hang up")
      || normalized.includes("py-strategy-service")
      || normalized.includes("grid_python_timeout")
      || normalized.includes("strategy_timeout");
  }

  async function computeGridMarginAdjustment(params: {
    row: any;
    userId: string;
    amountUsd: number;
    mode: "add" | "remove";
  }) {
    const marginMode = String(params.row.marginMode ?? (params.row.autoMarginEnabled ? "AUTO" : "MANUAL"));
    const currentInvestUsd = Number(params.row.investUsd ?? 0);
    const currentExtraMarginUsd = Number(params.row.extraMarginUsd ?? 0);
    const currentTotalBudgetUsd = shared.toTwoDecimals(currentInvestUsd + currentExtraMarginUsd);
    const nextTotalBudgetUsd = params.mode === "add"
      ? shared.toTwoDecimals(currentTotalBudgetUsd + params.amountUsd)
      : shared.toTwoDecimals(Math.max(0.01, currentTotalBudgetUsd - params.amountUsd));
    const nextExtraMarginUsd = params.mode === "add"
      ? shared.toTwoDecimals(currentExtraMarginUsd + params.amountUsd)
      : shared.toTwoDecimals(Math.max(0, currentExtraMarginUsd - params.amountUsd));
    const nextManualTransferUsd = params.mode === "add"
      ? shared.toTwoDecimals(params.amountUsd)
      : shared.toTwoDecimals(Math.max(0, currentExtraMarginUsd - nextExtraMarginUsd));

    const computed = await deps.computeGridPreviewAndAllocation({
      userId: params.userId,
      exchangeAccountId: params.row.exchangeAccountId,
      template: params.row.template,
      autoReservePolicy: params.row.autoReservePolicy ?? params.row.template.autoReservePolicy ?? "LIQ_GUARD_MAX_GRID",
      autoReserveFixedGridPct: params.row.autoReserveFixedGridPct ?? params.row.template.autoReserveFixedGridPct ?? 70,
      autoReserveTargetLiqDistancePct: params.row.autoReserveTargetLiqDistancePct ?? params.row.template.autoReserveTargetLiqDistancePct ?? null,
      autoReserveMaxPreviewIterations: params.row.autoReserveMaxPreviewIterations ?? params.row.template.autoReserveMaxPreviewIterations ?? 8,
      activeOrderWindowSize: params.row.activeOrderWindowSize ?? params.row.template.activeOrderWindowSize ?? 100,
      recenterDriftLevels: params.row.recenterDriftLevels ?? params.row.template.recenterDriftLevels ?? 1,
      investUsd: marginMode === "AUTO" ? nextTotalBudgetUsd : currentInvestUsd,
      extraMarginUsd: marginMode === "AUTO" ? 0 : nextExtraMarginUsd,
      autoMarginEnabled: marginMode === "AUTO",
      tpPct: params.row.tpPct ?? params.row.template.tpDefaultPct ?? null,
      slPrice: params.row.slPrice ?? params.row.template.slDefaultPrice ?? null,
      triggerPrice: params.row.triggerPrice ?? null,
      leverage: params.row.leverage,
      slippagePct: params.row.slippagePct,
      resolveVenueContext: deps.resolveVenueContext
    });

    const projectedLiqEstimate = Number(computed.preview.liqEstimateLong ?? computed.preview.liqEstimateShort ?? NaN);
    const updateData = marginMode === "AUTO"
      ? {
          investUsd: computed.allocation.gridInvestUsd,
          extraMarginUsd: computed.allocation.extraMarginUsd
        }
      : {
          investUsd: currentInvestUsd,
          extraMarginUsd: nextExtraMarginUsd
        };
    const transferAmountUsd = marginMode === "AUTO"
      ? shared.toTwoDecimals(
          params.mode === "add"
            ? Math.max(0, computed.allocation.totalBudgetUsd - currentTotalBudgetUsd)
            : Math.max(0, currentTotalBudgetUsd - computed.allocation.totalBudgetUsd)
        )
      : nextManualTransferUsd;

    return {
      marginMode,
      computed,
      currentLiqEstimate: readGridInstanceLiqEstimate(params.row),
      projectedLiqEstimate: Number.isFinite(projectedLiqEstimate) ? projectedLiqEstimate : null,
      currentTotalBudgetUsd,
      nextTotalBudgetUsd: marginMode === "AUTO"
        ? shared.toTwoDecimals(computed.allocation.totalBudgetUsd)
        : shared.toTwoDecimals(updateData.investUsd + updateData.extraMarginUsd),
      updateData,
      transferAmountUsd
    };
  }

  app.post("/grid/instances/:id/margin/preview", requireAuth, async (req, res) => {
    if (!(await shared.requireGridFeatureEnabledOrRespond(res))) return;
    if (!(await shared.requireGridCapabilityOrRespond(res, deps))) return;
    const parsed = shared.gridMarginAdjustSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return res.status(400).json({ error: "invalid_payload", details: parsed.error.flatten() });
    }
    const mode = String((req.body as Record<string, unknown> | null)?.mode ?? "").trim().toLowerCase();
    if (mode !== "add" && mode !== "remove") {
      return res.status(400).json({ error: "invalid_margin_adjust_mode" });
    }

    const user = getUserFromLocals(res);
    try {
      const row = await deps.loadGridInstanceForUser({ db: deps.db, userId: user.id, instanceId: req.params.id });
      if (!row) return res.status(404).json({ error: "grid_instance_not_found" });

      const adjustment = await computeGridMarginAdjustment({
        row,
        userId: user.id,
        amountUsd: parsed.data.amountUsd,
        mode
      });

      return res.json(buildGridPreviewResponse({
        computed: adjustment.computed,
        marginMode: adjustment.marginMode === "AUTO" ? "AUTO" : "MANUAL",
        autoMarginEnabled: adjustment.marginMode === "AUTO",
        leverage: Number(row.leverage ?? 0),
        extras: {
          adjustment: {
            mode,
            requestedAmountUsd: shared.toTwoDecimals(parsed.data.amountUsd),
            transferAmountUsd: adjustment.transferAmountUsd,
            currentTotalBudgetUsd: adjustment.currentTotalBudgetUsd,
            nextTotalBudgetUsd: adjustment.nextTotalBudgetUsd,
            currentLiqEstimate: adjustment.currentLiqEstimate,
            projectedLiqEstimate: adjustment.projectedLiqEstimate,
            currentInvestUsd: Number(row.investUsd ?? 0),
            currentExtraMarginUsd: Number(row.extraMarginUsd ?? 0),
            nextInvestUsd: adjustment.updateData.investUsd,
            nextExtraMarginUsd: adjustment.updateData.extraMarginUsd
          }
        }
      }));
    } catch (error) {
      const mappedRisk = shared.mapRiskErrorToHttp(error);
      if (mappedRisk) {
        return res.status(mappedRisk.status).json({
          error: mappedRisk.code,
          reason: mappedRisk.reason
        });
      }
      if (isGridMarginPreviewDependencyError(error)) {
        return res.status(503).json({
          error: "grid_instance_margin_preview_dependency_unavailable",
          reason: String(error),
          retryable: true
        });
      }
      if (shared.isMissingTableError(error)) return res.status(503).json({ error: "grid_schema_not_ready" });
      return res.status(500).json({ error: "grid_instance_margin_preview_failed", reason: String(error) });
    }
  });

  app.post("/grid/instances/:id/claim-preview", requireAuth, async (req, res) => {
    if (!(await shared.requireGridFeatureEnabledOrRespond(res))) return;
    if (!(await shared.requireGridCapabilityOrRespond(res, deps))) return;
    const rawAmountUsd = (req.body as Record<string, unknown> | null)?.amountUsd;
    const normalizedAmountUsd = rawAmountUsd == null || String(rawAmountUsd).trim() === ""
      ? null
      : Number(rawAmountUsd);
    if (normalizedAmountUsd != null && (!Number.isFinite(normalizedAmountUsd) || normalizedAmountUsd <= 0)) {
      return res.status(400).json({ error: "invalid_payload" });
    }

    const user = getUserFromLocals(res);
    try {
      const row = await deps.loadGridInstanceForUser({ db: deps.db, userId: user.id, instanceId: req.params.id });
      if (!row) return res.status(404).json({ error: "grid_instance_not_found" });
      if (!isBotVaultV3Instance(row) || !deps.botVaultV3Service) {
        return res.status(409).json({ error: "grid_instance_claim_preview_unavailable" });
      }
      const preview = await deps.botVaultV3Service.previewClaimProfit({
        userId: user.id,
        botId: String(row.botId ?? row.bot?.id ?? ""),
        amountUsd: normalizedAmountUsd
      });
      return res.json({ ok: true, preview });
    } catch (error) {
      const reason = String(error);
      if (reason.includes("claim_profit_unavailable") || reason.includes("invalid_amount_usd")) {
        return res.status(400).json({ error: "grid_instance_claim_preview_failed", reason });
      }
      if (shared.isMissingTableError(error)) return res.status(503).json({ error: "grid_schema_not_ready" });
      return res.status(500).json({ error: "grid_instance_claim_preview_failed", reason });
    }
  });

  app.post("/grid/instances/:id/margin/add", requireAuth, async (req, res) => {
    if (!(await shared.requireGridFeatureEnabledOrRespond(res))) return;
    if (!(await shared.requireGridCapabilityOrRespond(res, deps))) return;
    const parsed = shared.gridMarginAdjustSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return res.status(400).json({ error: "invalid_payload", details: parsed.error.flatten() });
    }

    const user = getUserFromLocals(res);
    try {
      const row = await deps.loadGridInstanceForUser({ db: deps.db, userId: user.id, instanceId: req.params.id });
      if (!row) return res.status(404).json({ error: "grid_instance_not_found" });
      if (isBotVaultV3Instance(row)) {
        return res.status(409).json({
          error: "grid_instance_margin_add_requires_wallet_funding",
          reason: "bot_vault_v3_wallet_funding_required"
        });
      }
      const marginMode = String(row.marginMode ?? (row.autoMarginEnabled ? "AUTO" : "MANUAL"));
      if (marginMode === "AUTO") {
        const nextTotalBudget = shared.toTwoDecimals(Number(row.investUsd ?? 0) + Number(row.extraMarginUsd ?? 0) + parsed.data.amountUsd);
        const computed = await deps.computeGridPreviewAndAllocation({
          userId: user.id,
          exchangeAccountId: row.exchangeAccountId,
          template: row.template,
          autoReservePolicy: row.autoReservePolicy ?? row.template.autoReservePolicy ?? "LIQ_GUARD_MAX_GRID",
          autoReserveFixedGridPct: row.autoReserveFixedGridPct ?? row.template.autoReserveFixedGridPct ?? 70,
          autoReserveTargetLiqDistancePct: row.autoReserveTargetLiqDistancePct ?? row.template.autoReserveTargetLiqDistancePct ?? null,
          autoReserveMaxPreviewIterations: row.autoReserveMaxPreviewIterations ?? row.template.autoReserveMaxPreviewIterations ?? 8,
          activeOrderWindowSize: row.activeOrderWindowSize ?? row.template.activeOrderWindowSize ?? 100,
          recenterDriftLevels: row.recenterDriftLevels ?? row.template.recenterDriftLevels ?? 1,
          investUsd: nextTotalBudget,
          extraMarginUsd: 0,
          autoMarginEnabled: true,
          tpPct: row.tpPct ?? row.template.tpDefaultPct ?? null,
          slPrice: row.slPrice ?? row.template.slDefaultPrice ?? null,
          triggerPrice: row.triggerPrice ?? null,
          leverage: row.leverage,
          slippagePct: row.slippagePct,
          resolveVenueContext: deps.resolveVenueContext
        });

        if (computed.allocation.insufficient || computed.allocation.gridInvestUsd + 1e-9 < computed.minInvestmentUSDT) {
          return res.status(400).json(buildGridMinimumInvestmentErrorResponse({
            computed,
            currentInvestUsd: nextTotalBudget,
            symbol: String(row.template.symbol ?? ""),
            marginMode: "AUTO",
            autoMarginEnabled: true,
            leverage: Number(row.leverage ?? 0),
          }));
        }

        const updated = await deps.db.$transaction(async (tx: any) => {
          const nextRow = await tx.gridBotInstance.update({
            where: { id: row.id },
            data: {
              investUsd: computed.allocation.gridInvestUsd,
              extraMarginUsd: computed.allocation.extraMarginUsd
            }
          });
          const previousTotal = shared.toTwoDecimals(Number(row.investUsd ?? 0) + Number(row.extraMarginUsd ?? 0));
          const nextTotal = shared.toTwoDecimals(Number(nextRow.investUsd ?? 0) + Number(nextRow.extraMarginUsd ?? 0));
          const topUpDeltaUsd = shared.toTwoDecimals(Math.max(0, nextTotal - previousTotal));
          if (topUpDeltaUsd > 0) {
            const idempotencyKey = `grid_instance:${row.id}:margin_add:${buildGridMarginActionRequestKey({
              actionKey: "marginAddTopUp",
              rowId: String(row.id),
              requestedAmountUsd: parsed.data.amountUsd,
              transferAmountUsd: topUpDeltaUsd,
              currentInvestUsd: Number(row.investUsd ?? 0),
              currentExtraMarginUsd: Number(row.extraMarginUsd ?? 0),
              nextInvestUsd: Number(nextRow.investUsd ?? 0),
              nextExtraMarginUsd: Number(nextRow.extraMarginUsd ?? 0),
              marginMode
            })}`;
            await deps.vaultService.topUpBotVaultForGridInstance({
              tx,
              userId: user.id,
              gridInstanceId: String(row.id),
              amountUsd: topUpDeltaUsd,
              idempotencyKey,
              metadata: {
                sourceType: "grid_margin_add_auto"
              }
            });
          }
          return nextRow;
        });
        return res.json({
          ok: true,
          id: updated.id,
          investUsd: updated.investUsd,
          extraMarginUsd: updated.extraMarginUsd
        });
      }
      const updated = await deps.db.$transaction(async (tx: any) => {
        const nextRow = await tx.gridBotInstance.update({
          where: { id: row.id },
          data: {
            extraMarginUsd: Number(row.extraMarginUsd ?? 0) + parsed.data.amountUsd
          }
        });
        const idempotencyKey = `grid_instance:${row.id}:margin_add:${buildGridMarginActionRequestKey({
          actionKey: "marginAddTopUp",
          rowId: String(row.id),
          requestedAmountUsd: parsed.data.amountUsd,
          transferAmountUsd: parsed.data.amountUsd,
          currentInvestUsd: Number(row.investUsd ?? 0),
          currentExtraMarginUsd: Number(row.extraMarginUsd ?? 0),
          nextInvestUsd: Number(nextRow.investUsd ?? 0),
          nextExtraMarginUsd: Number(nextRow.extraMarginUsd ?? 0),
          marginMode
        })}`;
        await deps.vaultService.topUpBotVaultForGridInstance({
          tx,
          userId: user.id,
          gridInstanceId: String(row.id),
          amountUsd: parsed.data.amountUsd,
          idempotencyKey,
          metadata: {
            sourceType: "grid_margin_add_manual"
          }
        });
        return nextRow;
      });
      return res.json({
        ok: true,
        id: updated.id,
        investUsd: updated.investUsd,
        extraMarginUsd: updated.extraMarginUsd
      });
    } catch (error) {
      const mappedRisk = shared.mapRiskErrorToHttp(error);
      if (mappedRisk) {
        return res.status(mappedRisk.status).json({
          error: mappedRisk.code,
          reason: mappedRisk.reason
        });
      }
      if (shared.isMissingTableError(error)) return res.status(503).json({ error: "grid_schema_not_ready" });
      return res.status(500).json({ error: "grid_instance_margin_add_failed", reason: String(error) });
    }
  });

  app.post("/grid/instances/:id/margin/add/finalize", requireAuth, async (req, res) => {
    if (!(await shared.requireGridFeatureEnabledOrRespond(res))) return;
    if (!(await shared.requireGridCapabilityOrRespond(res, deps))) return;
    const parsed = shared.gridMarginAdjustSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return res.status(400).json({ error: "invalid_payload", details: parsed.error.flatten() });
    }

    const user = getUserFromLocals(res);
    try {
      const row = await deps.loadGridInstanceForUser({ db: deps.db, userId: user.id, instanceId: req.params.id });
      if (!row) return res.status(404).json({ error: "grid_instance_not_found" });
      if (!isBotVaultV3Instance(row) || !deps.botVaultV3Service || !row.botVault?.id) {
        return res.status(409).json({ error: "grid_instance_margin_add_finalize_unavailable" });
      }

      const adjustment = await computeGridMarginAdjustment({
        row,
        userId: user.id,
        amountUsd: parsed.data.amountUsd,
        mode: "add"
      });

      if (adjustment.computed.allocation.insufficient || adjustment.computed.allocation.gridInvestUsd + 1e-9 < adjustment.computed.minInvestmentUSDT) {
        return res.status(400).json(buildGridMinimumInvestmentErrorResponse({
          computed: adjustment.computed,
          currentInvestUsd: adjustment.nextTotalBudgetUsd,
          symbol: String(row.template.symbol ?? ""),
          marginMode: adjustment.marginMode === "AUTO" ? "AUTO" : "MANUAL",
          autoMarginEnabled: adjustment.marginMode === "AUTO",
          leverage: Number(row.leverage ?? 0),
        }));
      }
      if (adjustment.transferAmountUsd <= 0) {
        return res.status(400).json({ error: "invalid_amount_usd" });
      }
      const requestKey = buildGridMarginActionRequestKey({
        actionKey: "marginAddFinalize",
        rowId: String(row.id),
        botVaultId: String(row.botVault.id),
        requestedAmountUsd: parsed.data.amountUsd,
        transferAmountUsd: adjustment.transferAmountUsd,
        currentInvestUsd: Number(row.investUsd ?? 0),
        currentExtraMarginUsd: Number(row.extraMarginUsd ?? 0),
        nextInvestUsd: Number(adjustment.updateData.investUsd),
        nextExtraMarginUsd: Number(adjustment.updateData.extraMarginUsd),
        marginMode: adjustment.marginMode
      });
      const pendingAction = findPendingGridQuickAction(row.stateJson);
      if (pendingAction && (pendingAction.actionKey !== "marginAddFinalize" || String(pendingAction.actionState.requestKey ?? "") !== requestKey)) {
        return res.status(409).json(buildGridMarginActionConflictPayload(pendingAction));
      }

      const existingAction = readGridQuickActionState(row.stateJson, "marginAddFinalize");
      const canResumeFromGridState =
        String(existingAction.requestKey ?? "") === requestKey
        && hasPendingGridQuickAction(existingAction);
      const canResumeFromBotVault = hasStoredMarginAddFinalization(row, adjustment.transferAmountUsd);

      let result: any = existingAction.result ?? null;
      let actionSource: "fresh_call" | "grid_state_resume" | "bot_vault_resume" = "fresh_call";
      if (!canResumeFromGridState && !canResumeFromBotVault) {
        const pendingStateJson = buildGridQuickActionStateJson({
          stateJson: row.stateJson,
          actionKey: "marginAddFinalize",
          actionState: buildMarginActionState({
            requestKey,
            requestedAmountUsd: parsed.data.amountUsd,
            transferAmountUsd: adjustment.transferAmountUsd,
            updateData: adjustment.updateData,
            stage: "pending_external",
            source: "fresh_call"
          })
        });
        await deps.db.gridBotInstance.update({
          where: { id: row.id },
          data: { stateJson: pendingStateJson }
        });
        result = await deps.botVaultV3Service.finalizeMarginAdd({
          userId: user.id,
          botVaultId: String(row.botVault.id),
          amountUsd: adjustment.transferAmountUsd
        });
      } else {
        actionSource = canResumeFromGridState ? "grid_state_resume" : "bot_vault_resume";
      }

      const appliedStateJson = buildGridQuickActionStateJson({
        stateJson: row.stateJson,
        actionKey: "marginAddFinalize",
        actionState: buildMarginActionState({
          requestKey,
          requestedAmountUsd: parsed.data.amountUsd,
          transferAmountUsd: adjustment.transferAmountUsd,
          updateData: adjustment.updateData,
          stage: "applied",
          source: actionSource,
          result
        })
      });

      let updated: any;
      try {
        updated = await deps.db.gridBotInstance.update({
          where: { id: row.id },
          data: {
            ...adjustment.updateData,
            stateJson: appliedStateJson
          }
        });
      } catch (updateError) {
        if (!canResumeFromGridState && !canResumeFromBotVault) {
          const confirmedStateJson = buildGridQuickActionStateJson({
            stateJson: row.stateJson,
            actionKey: "marginAddFinalize",
            actionState: buildMarginActionState({
              requestKey,
              requestedAmountUsd: parsed.data.amountUsd,
              transferAmountUsd: adjustment.transferAmountUsd,
              updateData: adjustment.updateData,
              stage: "external_confirmed",
              source: "fresh_call",
              result
            })
          });
          await deps.db.gridBotInstance.update({
            where: { id: row.id },
            data: { stateJson: confirmedStateJson }
          }).catch(() => undefined);
        }
        throw updateError;
      }

      return res.json({
        ok: true,
        id: updated.id,
        investUsd: updated.investUsd,
        extraMarginUsd: updated.extraMarginUsd,
        result,
        actionState: {
          state: actionSource === "fresh_call" ? "applied" : "resumed_local_apply",
          requestKey,
          resumeable: false,
          externalHandled: true
        }
      });
    } catch (error) {
      const mappedRisk = shared.mapRiskErrorToHttp(error);
      if (mappedRisk) {
        return res.status(mappedRisk.status).json({
          error: mappedRisk.code,
          reason: mappedRisk.reason
        });
      }
      if (shared.isMissingTableError(error)) return res.status(503).json({ error: "grid_schema_not_ready" });
      return res.status(500).json({ error: "grid_instance_margin_add_finalize_failed", reason: String(error) });
    }
  });

  app.post("/grid/instances/:id/margin/remove", requireAuth, async (req, res) => {
    if (!(await shared.requireGridFeatureEnabledOrRespond(res))) return;
    if (!(await shared.requireGridCapabilityOrRespond(res, deps))) return;
    const parsed = shared.gridMarginAdjustSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return res.status(400).json({ error: "invalid_payload", details: parsed.error.flatten() });
    }

    const user = getUserFromLocals(res);
    try {
      const row = await deps.loadGridInstanceForUser({ db: deps.db, userId: user.id, instanceId: req.params.id });
      if (!row) return res.status(404).json({ error: "grid_instance_not_found" });
      const adjustment = await computeGridMarginAdjustment({
        row,
        userId: user.id,
        amountUsd: parsed.data.amountUsd,
        mode: "remove"
      });
      if (adjustment.computed.allocation.insufficient || adjustment.computed.allocation.gridInvestUsd + 1e-9 < adjustment.computed.minInvestmentUSDT) {
        return res.status(400).json(buildGridMinimumInvestmentErrorResponse({
          computed: adjustment.computed,
          currentInvestUsd: adjustment.nextTotalBudgetUsd,
          symbol: String(row.template.symbol ?? ""),
          marginMode: adjustment.marginMode === "AUTO" ? "AUTO" : "MANUAL",
          autoMarginEnabled: adjustment.marginMode === "AUTO",
          leverage: Number(row.leverage ?? 0),
        }));
      }

      let result: any = null;
      let actionSource: "fresh_call" | "grid_state_resume" | "bot_vault_resume" = "fresh_call";
      if (isBotVaultV3Instance(row) && deps.botVaultV3Service && row.botVault?.id && adjustment.transferAmountUsd > 0) {
        const requestKey = buildGridMarginActionRequestKey({
          actionKey: "marginRemove",
          rowId: String(row.id),
          botVaultId: String(row.botVault.id),
          requestedAmountUsd: parsed.data.amountUsd,
          transferAmountUsd: adjustment.transferAmountUsd,
          currentInvestUsd: Number(row.investUsd ?? 0),
          currentExtraMarginUsd: Number(row.extraMarginUsd ?? 0),
          nextInvestUsd: Number(adjustment.updateData.investUsd),
          nextExtraMarginUsd: Number(adjustment.updateData.extraMarginUsd),
          marginMode: adjustment.marginMode
        });
        const pendingAction = findPendingGridQuickAction(row.stateJson);
        if (pendingAction && (pendingAction.actionKey !== "marginRemove" || String(pendingAction.actionState.requestKey ?? "") !== requestKey)) {
          return res.status(409).json(buildGridMarginActionConflictPayload(pendingAction));
        }
        const existingAction = readGridQuickActionState(row.stateJson, "marginRemove");
        const canResumeFromGridState =
          String(existingAction.requestKey ?? "") === requestKey
          && hasPendingGridQuickAction(existingAction);
        const canResumeFromBotVault = hasStoredReduceMarginFinalization(row, adjustment.transferAmountUsd);
        if (!canResumeFromGridState && !canResumeFromBotVault) {
          const pendingStateJson = buildGridQuickActionStateJson({
            stateJson: row.stateJson,
            actionKey: "marginRemove",
            actionState: buildMarginActionState({
              requestKey,
              requestedAmountUsd: parsed.data.amountUsd,
              transferAmountUsd: adjustment.transferAmountUsd,
              updateData: adjustment.updateData,
              stage: "pending_external",
              source: "fresh_call"
            })
          });
          await deps.db.gridBotInstance.update({
            where: { id: row.id },
            data: { stateJson: pendingStateJson }
          });
          result = await deps.botVaultV3Service.reduceMargin({
            userId: user.id,
            botVaultId: String(row.botVault.id),
            amountUsd: adjustment.transferAmountUsd
          });
        } else {
          actionSource = canResumeFromGridState ? "grid_state_resume" : "bot_vault_resume";
          result = existingAction.result ?? null;
        }

        const appliedStateJson = buildGridQuickActionStateJson({
          stateJson: row.stateJson,
          actionKey: "marginRemove",
          actionState: buildMarginActionState({
            requestKey,
            requestedAmountUsd: parsed.data.amountUsd,
            transferAmountUsd: adjustment.transferAmountUsd,
            updateData: adjustment.updateData,
            stage: "applied",
            source: actionSource,
            result
          })
        });
        let updated: any;
        try {
          updated = await deps.db.gridBotInstance.update({
            where: { id: row.id },
            data: {
              ...adjustment.updateData,
              stateJson: appliedStateJson
            }
          });
        } catch (updateError) {
          if (!canResumeFromGridState && !canResumeFromBotVault) {
            const confirmedStateJson = buildGridQuickActionStateJson({
              stateJson: row.stateJson,
              actionKey: "marginRemove",
              actionState: buildMarginActionState({
                requestKey,
                requestedAmountUsd: parsed.data.amountUsd,
                transferAmountUsd: adjustment.transferAmountUsd,
                updateData: adjustment.updateData,
                stage: "external_confirmed",
                source: "fresh_call",
                result
              })
            });
            await deps.db.gridBotInstance.update({
              where: { id: row.id },
              data: { stateJson: confirmedStateJson }
            }).catch(() => undefined);
          }
          throw updateError;
        }

        return res.json({
          ok: true,
          id: updated.id,
          investUsd: updated.investUsd,
          extraMarginUsd: updated.extraMarginUsd,
          result,
          actionState: {
            state: actionSource === "fresh_call" ? "applied" : "resumed_local_apply",
            requestKey,
            resumeable: false,
            externalHandled: true
          }
        });
      }
      const updated = await deps.db.gridBotInstance.update({
        where: { id: row.id },
        data: adjustment.updateData
      });
      return res.json({
        ok: true,
        id: updated.id,
        investUsd: updated.investUsd,
        extraMarginUsd: updated.extraMarginUsd,
        result
      });
    } catch (error) {
      const mappedRisk = shared.mapRiskErrorToHttp(error);
      if (mappedRisk) {
        return res.status(mappedRisk.status).json({
          error: mappedRisk.code,
          reason: mappedRisk.reason
        });
      }
      if (shared.isMissingTableError(error)) return res.status(503).json({ error: "grid_schema_not_ready" });
      return res.status(500).json({ error: "grid_instance_margin_remove_failed", reason: String(error) });
    }
  });

  app.post("/grid/instances/:id/withdraw-profit", requireAuth, async (req, res) => {
    if (!(await shared.requireGridFeatureEnabledOrRespond(res))) return;
    if (!(await shared.requireGridCapabilityOrRespond(res, deps))) return;
    const parsed = shared.gridWithdrawSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return res.status(400).json({ error: "invalid_payload", details: parsed.error.flatten() });
    }

    const user = getUserFromLocals(res);
    try {
      const row = await deps.loadGridInstanceForUser({ db: deps.db, userId: user.id, instanceId: req.params.id });
      if (!row) return res.status(404).json({ error: "grid_instance_not_found" });
      if (isBotVaultV3Instance(row) && deps.botVaultV3Service) {
        const result = await deps.botVaultV3Service.claimProfit({
          userId: user.id,
          botId: String(row.botId ?? row.bot?.id ?? ""),
          amountUsd: parsed.data.amountUsd
        });
        return res.json({
          ok: true,
          id: row.id,
          result,
          actionState: {
            state: result.postProcessingStage === "applied" ? "applied" : "pending_post_processing",
            resumeable: result.postProcessingStage !== "applied",
            reason: result.postProcessingReason
          }
        });
      }
      const result = await deps.vaultService.withdrawFromGridInstance({
        userId: user.id,
        gridInstanceId: row.id,
        amountUsd: parsed.data.amountUsd
      });
      return res.json({
        ok: true,
        id: row.id,
        withdrawnProfitUsd: result.botVault.withdrawnUsd,
        botVault: result.botVault,
        settlement: result.settlement
      });
    } catch (error) {
      const reason = String(error);
      if (reason.includes("insufficient_withdrawable_profit")) {
        return res.status(400).json({
          error: "insufficient_withdrawable_profit"
        });
      }
      if (reason.includes("claim_profit_unavailable") || reason.includes("invalid_amount_usd")) {
        return res.status(400).json({
          error: "grid_instance_withdraw_failed",
          reason
        });
      }
      if (shared.isMissingTableError(error)) return res.status(503).json({ error: "grid_schema_not_ready" });
      return res.status(500).json({ error: "grid_instance_withdraw_failed", reason: String(error) });
    }
  });

  app.get("/grid/instances/:id/metrics", requireAuth, async (req, res) => {
    if (!(await shared.requireGridFeatureEnabledOrRespond(res))) return;
    if (!(await shared.requireGridCapabilityOrRespond(res, deps))) return;
    const user = getUserFromLocals(res);
    try {
      const row = await deps.loadGridInstanceForUser({ db: deps.db, userId: user.id, instanceId: req.params.id });
      if (!row) return res.status(404).json({ error: "grid_instance_not_found" });
      return res.json({
        id: row.id,
        state: row.state,
        metrics: row.metricsJson ?? {},
        stateJson: row.stateJson ?? {},
        lastPlanAt: row.lastPlanAt ?? null,
        lastPlanError: row.lastPlanError ?? null,
        lastPlanVersion: row.lastPlanVersion ?? null
      });
    } catch (error) {
      if (shared.isMissingTableError(error)) return res.status(503).json({ error: "grid_schema_not_ready" });
      return res.status(500).json({ error: "grid_instance_metrics_failed", reason: String(error) });
    }
  });

  app.get("/grid/instances/:id/orders", requireAuth, async (req, res) => {
    if (!(await shared.requireGridFeatureEnabledOrRespond(res))) return;
    if (!(await shared.requireGridCapabilityOrRespond(res, deps))) return;
    const user = getUserFromLocals(res);
    try {
      const row = await deps.loadGridInstanceForUser({ db: deps.db, userId: user.id, instanceId: req.params.id });
      if (!row) return res.status(404).json({ error: "grid_instance_not_found" });
      const items = await deps.db.gridBotOrderMap.findMany({
        where: {
          instanceId: row.id,
          status: "open"
        },
        orderBy: [{ updatedAt: "desc" }],
        take: 200
      });
      const botVaultId = String(row.botVault?.id ?? "").trim();
      if (!botVaultId || !deps.db?.botOrder?.findMany) {
        return res.json({ items: Array.isArray(items) ? items : [] });
      }

      const fallbackRows = await deps.db.botOrder.findMany({
        where: {
          botVaultId,
          status: "OPEN",
          clientOrderId: {
            startsWith: `grid-${row.id}-`
          }
        },
        orderBy: [{ updatedAt: "desc" }],
        take: 200
      });

      const fallbackItems = (Array.isArray(fallbackRows) ? fallbackRows : []).map((entry: any) => {
        const metadata = entry?.metadata && typeof entry.metadata === "object" && !Array.isArray(entry.metadata)
          ? entry.metadata
          : {};
        return {
          id: String(entry.id),
          exchangeOrderId: entry.exchangeOrderId ? String(entry.exchangeOrderId) : null,
          clientOrderId: String(entry.clientOrderId ?? ""),
          gridLeg: String(metadata.gridLeg ?? "").trim().toLowerCase() === "short" ? "short" : "long",
          gridIndex: Number.isFinite(Number(metadata.gridIndex)) ? Math.max(0, Math.trunc(Number(metadata.gridIndex))) : 0,
          intentType: normalizeGridIntentType(metadata.intentType),
          side: String(entry.side ?? "").trim().toUpperCase() === "SELL" ? "sell" : "buy",
          price: Number.isFinite(Number(entry.price)) ? Number(entry.price) : null,
          qty: Number(entry.qty ?? 0),
          reduceOnly: entry.reduceOnly === true,
          status: "open",
          createdAt: entry.createdAt instanceof Date ? entry.createdAt.toISOString() : new Date(entry.createdAt ?? Date.now()).toISOString(),
          updatedAt: entry.updatedAt instanceof Date ? entry.updatedAt.toISOString() : new Date(entry.updatedAt ?? Date.now()).toISOString()
        };
      }).filter((entry: any) => entry.clientOrderId && Number.isFinite(entry.qty) && entry.qty > 0);

      return res.json({ items: mergeGridOrders(items, fallbackItems) });
    } catch (error) {
      if (shared.isMissingTableError(error)) return res.status(503).json({ error: "grid_schema_not_ready" });
      return res.status(500).json({ error: "grid_instance_orders_failed", reason: String(error) });
    }
  });

  app.get("/grid/instances/:id/fills", requireAuth, async (req, res) => {
    if (!(await shared.requireGridFeatureEnabledOrRespond(res))) return;
    if (!(await shared.requireGridCapabilityOrRespond(res, deps))) return;
    const user = getUserFromLocals(res);
    try {
      const row = await deps.loadGridInstanceForUser({ db: deps.db, userId: user.id, instanceId: req.params.id });
      if (!row) return res.status(404).json({ error: "grid_instance_not_found" });
      const items = await deps.db.gridBotFillEvent.findMany({
        where: { instanceId: row.id },
        orderBy: [{ fillTs: "desc" }],
        take: 200
      });
      if (Array.isArray(items) && items.length > 0) {
        return res.json({ items });
      }

      const botVaultId = String(row.botVault?.id ?? "").trim();
      if (!botVaultId || !deps.db?.botFill?.findMany) {
        return res.json({ items: Array.isArray(items) ? items : [] });
      }

      const [botFillRows, gridOrderRows, botOrderRows] = await Promise.all([
        deps.db.botFill.findMany({
          where: { botVaultId },
          orderBy: [{ fillTs: "desc" }],
          take: 200
        }),
        deps.db.gridBotOrderMap.findMany({
          where: { instanceId: row.id },
          orderBy: [{ updatedAt: "desc" }],
          take: 500
        }),
        deps.db.botOrder.findMany({
          where: {
            botVaultId,
            clientOrderId: {
              startsWith: `grid-${row.id}-`
            }
          },
          orderBy: [{ updatedAt: "desc" }],
          take: 500
        }).catch(() => [])
      ]);

      const orderLookup = buildGridOrderLookup([
        ...(Array.isArray(gridOrderRows) ? gridOrderRows : []),
        ...(Array.isArray(botOrderRows) ? botOrderRows : [])
      ]);

      const fallbackItems = (Array.isArray(botFillRows) ? botFillRows : []).map((entry: any) => {
        const metadata = entry?.metadata && typeof entry.metadata === "object" && !Array.isArray(entry.metadata)
          ? entry.metadata
          : {};
        const raw = metadata?.raw && typeof metadata.raw === "object" && !Array.isArray(metadata.raw)
          ? metadata.raw as Record<string, unknown>
          : {};
        const refs = new Set<string>([
          ...collectCanonicalOrderReferenceKeys([
            { value: entry?.exchangeOrderId, hint: "exchange" },
            { value: metadata.clientOrderId, hint: "client_or_cloid" },
            { value: raw.cloid, hint: "cloid" },
            { value: raw.oid, hint: "exchange" }
          ]),
          ...[
            entry?.exchangeOrderId,
            metadata.clientOrderId,
            raw.cloid,
            raw.oid
          ].flatMap((value) => [...collectOrderReferenceCandidates(value)])
            .filter((ref) => !isAmbiguousBareNumericRef(ref))
        ]);
        const matchedOrder = [...refs].map((ref) => orderLookup.get(ref)).find(Boolean) ?? null;
        const clientOrderId = normalizeDbText(
          matchedOrder?.clientOrderId
          ?? metadata.clientOrderId
          ?? raw.cloid
        ) || null;
        const rawJson = {
          ...(Object.keys(raw).length > 0 ? raw : {}),
          ...(matchedOrder?.intentType ? { intentType: matchedOrder.intentType } : {})
        };
        return {
          id: String(entry.id),
          exchangeOrderId: entry.exchangeOrderId ? String(entry.exchangeOrderId) : null,
          clientOrderId,
          fillPrice: Number(entry.price ?? 0),
          fillQty: Number(entry.qty ?? 0),
          fillNotionalUsd: Number(entry.notional ?? 0),
          feeUsd: Number(entry.feeAmount ?? 0),
          side: String(entry.side ?? "").trim().toUpperCase() === "SELL" ? "sell" : "buy",
          gridLeg: matchedOrder?.gridLeg ?? inferGridLeg({
            clientOrderId,
            side: entry?.side,
            rawDir: raw.dir
          }),
          gridIndex: matchedOrder?.gridIndex ?? inferGridIndex(clientOrderId),
          fillTs: entry.fillTs instanceof Date ? entry.fillTs.toISOString() : new Date(entry.fillTs ?? Date.now()).toISOString(),
          rawJson
        };
      }).filter((entry: any) => Number.isFinite(entry.fillPrice) && entry.fillPrice > 0 && Number.isFinite(entry.fillQty) && entry.fillQty > 0);

      return res.json({ items: fallbackItems });
    } catch (error) {
      if (shared.isMissingTableError(error)) return res.status(503).json({ error: "grid_schema_not_ready" });
      return res.status(500).json({ error: "grid_instance_fills_failed", reason: String(error) });
    }
  });

  app.get("/grid/instances/:id/events", requireAuth, async (req, res) => {
    if (!(await shared.requireGridFeatureEnabledOrRespond(res))) return;
    if (!(await shared.requireGridCapabilityOrRespond(res, deps))) return;
    const user = getUserFromLocals(res);
    try {
      const row = await deps.loadGridInstanceForUser({ db: deps.db, userId: user.id, instanceId: req.params.id });
      if (!row) return res.status(404).json({ error: "grid_instance_not_found" });
      const items = await deps.db.riskEvent.findMany({
        where: { botId: row.botId },
        orderBy: [{ createdAt: "desc" }],
        take: 200
      });
      return res.json({ items });
    } catch (error) {
      if (shared.isMissingTableError(error)) return res.status(503).json({ error: "grid_schema_not_ready" });
      return res.status(500).json({ error: "grid_instance_events_failed", reason: String(error) });
    }
  });
}
