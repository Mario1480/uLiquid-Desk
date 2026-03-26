import type { Express } from "express";
import { z } from "zod";
import type { CapabilityKey, PlanCapabilities, PlanTier } from "@mm/core";
import { getUserFromLocals, requireAuth } from "../auth.js";
import { createFundingReadService } from "../funding/fundingRead.service.js";
import type { FundingReadService } from "../funding/types.js";
import { createTransferReadService } from "../transfers/transferRead.service.js";
import type { TransferReadService } from "../transfers/types.js";
import type { VaultService } from "../vaults/service.js";
import type { OnchainActionService } from "../vaults/onchainAction.service.js";
import { createWalletReadService, type WalletReadService } from "../wallet/hyperliquidRead.service.js";

const botVaultListQuerySchema = z.object({
  gridInstanceId: z.string().trim().min(1).optional()
});

const ledgerQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(500).default(200)
});

const feeEventsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(500).default(200)
});

const executionEventsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(500).default(200)
});

const pnlReportQuerySchema = z.object({
  fillsLimit: z.coerce.number().int().min(1).max(100).default(20)
});

const auditQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.string().trim().min(1).optional()
});

const closeOnlyMutationSchema = z.object({
  reason: z.string().trim().min(1).max(500).optional()
});

const onchainActionListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50)
});

const onchainCreateMasterTxSchema = z.object({
  actionKey: z.string().trim().min(1).max(190).optional()
});

const onchainDepositMasterTxSchema = z.object({
  amountUsd: z.number().positive(),
  actionKey: z.string().trim().min(1).max(190).optional()
});

const onchainWithdrawMasterTxSchema = z.object({
  amountUsd: z.number().positive(),
  actionKey: z.string().trim().min(1).max(190).optional()
});

const onchainCreateBotTxSchema = z.object({
  allocationUsd: z.number().positive(),
  actionKey: z.string().trim().min(1).max(190).optional()
});

const onchainClaimTxSchema = z.object({
  releasedReservedUsd: z.number().min(0).optional(),
  returnedToFreeUsd: z.number().min(0).optional(),
  grossReturnedUsd: z.number().min(0).optional(),
  actionKey: z.string().trim().min(1).max(190).optional()
});

const onchainCloseTxSchema = z.object({
  releasedReservedUsd: z.number().min(0).optional(),
  returnedToFreeUsd: z.number().min(0).optional(),
  grossReturnedUsd: z.number().min(0).optional(),
  actionKey: z.string().trim().min(1).max(190).optional()
});

const onchainSubmitTxSchema = z.object({
  txHash: z.string().trim().min(66).max(66)
});

const accrualQuerySchema = z.object({
  botVaultId: z.string().trim().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(200)
});

const masterVaultCashMutationSchema = z.object({
  amountUsd: z.number().positive(),
  idempotencyKey: z.string().trim().min(1),
  metadata: z.record(z.unknown()).optional()
});

const walletAddressParamSchema = z.object({
  address: z.string().trim().min(1)
});

const walletActivityQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(20)
});

const vaultAddressParamSchema = z.object({
  vaultAddress: z.string().trim().min(1)
});

const vaultDetailQuerySchema = z.object({
  user: z.string().trim().min(1).optional()
});

function extractRiskErrorCode(error: unknown): string | null {
  if (error && typeof error === "object") {
    const rawCode = "code" in error ? String((error as any).code ?? "").trim() : "";
    if (rawCode.startsWith("risk_")) return rawCode;
  }
  const message = error instanceof Error
    ? String(error.message ?? "")
    : String(error ?? "");
  const match = message.match(/risk_[a-z0-9_]+/i);
  if (!match?.[0]) return null;
  return match[0].toLowerCase();
}

function mapRiskErrorToHttp(error: unknown): { status: number; code: string; reason: string } | null {
  const code = extractRiskErrorCode(error);
  if (!code) return null;
  const status = code === "risk_invalid_status_transition" ? 409 : 400;
  return {
    status,
    code,
    reason: error instanceof Error ? String(error.message ?? code) : code
  };
}

export function registerVaultRoutes(
  app: Express,
  deps: {
    vaultService: VaultService;
    onchainActionService?: OnchainActionService | null;
    walletReadService?: WalletReadService | null;
    fundingReadService?: FundingReadService | null;
    transferReadService?: TransferReadService | null;
    resolvePlanCapabilitiesForUserId?(input: {
      userId: string;
    }): Promise<{ plan: PlanTier; capabilities: PlanCapabilities }>;
    isCapabilityAllowed?(capabilities: PlanCapabilities, capability: CapabilityKey): boolean;
    sendCapabilityDenied?(
      res: any,
      params: {
        capability: CapabilityKey;
        currentPlan: PlanTier;
        legacyCode?: string;
      }
    ): any;
  }
) {
  const onchainActionService = deps.onchainActionService ?? null;
  const walletReadService = deps.walletReadService ?? createWalletReadService();
  const fundingReadService = deps.fundingReadService ?? createFundingReadService();
  const transferReadService = deps.transferReadService ?? createTransferReadService();
  const requireVaultProductAccess = async (_req: unknown, res: any, next: () => void) => {
    if (!deps.resolvePlanCapabilitiesForUserId || !deps.isCapabilityAllowed || !deps.sendCapabilityDenied) {
      next();
      return;
    }
    const user = getUserFromLocals(res);
    const capabilityContext = await deps.resolvePlanCapabilitiesForUserId({
      userId: user.id
    });
    if (!deps.isCapabilityAllowed(capabilityContext.capabilities, "product.vaults")) {
      deps.sendCapabilityDenied(res, {
        capability: "product.vaults",
        currentPlan: capabilityContext.plan,
        legacyCode: "vaults_not_available"
      });
      return;
    }
    next();
  };

  function mapOnchainError(error: unknown) {
    const reason = String(error ?? "");
    if (
      reason.includes("bot_vault_onchain_close_only_already_set")
      || reason.includes("bot_vault_onchain_close_only_invalid_status")
    ) {
      return { status: 409, error: "onchain_close_only_unavailable", reason };
    }
    if (reason.includes("bot_vault_onchain_close_only_required")) {
      return { status: 409, error: "onchain_close_only_required", reason };
    }
    if (reason.includes("vault_execution_mode_offchain_shadow")) {
      return { status: 409, error: "vault_execution_mode_offchain_shadow", reason };
    }
    if (
      reason.includes("wallet_address_required")
      || reason.includes("master_vault_onchain_address_missing")
      || reason.includes("bot_vault_onchain_address_missing")
      || reason.includes("invalid_amount_usd")
      || reason.includes("invalid_tx_hash")
      || reason.includes("bot_vault_released_reserved_exceeds_outstanding")
      || reason.includes("bot_vault_released_reserved_exceeds_master_reserved")
      || reason.includes("bot_vault_gross_return_exceeds_limit")
      || reason.includes("vault_onchain_")
    ) {
      return { status: 400, error: "onchain_invalid_request", reason };
    }
    if (
      reason.includes("bot_vault_not_found")
      || reason.includes("master_vault_not_found")
      || reason.includes("onchain_action_not_found")
      || reason.includes("user_not_found")
    ) {
      return { status: 404, error: "onchain_resource_not_found", reason };
    }
    if (reason.includes("tx_hash_already_linked") || reason.includes("already")) {
      return { status: 409, error: "onchain_conflict", reason };
    }
    return { status: 500, error: "onchain_action_failed", reason };
  }

  app.post("/vaults/master/create", requireAuth, requireVaultProductAccess, async (_req, res) => {
    const user = getUserFromLocals(res);
    try {
      const vault = await deps.vaultService.ensureMasterVaultExplicit({
        userId: user.id
      });
      return res.json({
        ok: true,
        vault
      });
    } catch (error) {
      return res.status(500).json({
        error: "vault_master_create_failed",
        reason: String(error)
      });
    }
  });

  app.post("/vaults/master/deposit", requireAuth, requireVaultProductAccess, async (req, res) => {
    const parsed = masterVaultCashMutationSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return res.status(400).json({
        error: "invalid_payload",
        details: parsed.error.flatten()
      });
    }
    const user = getUserFromLocals(res);
    try {
      await deps.vaultService.depositToMasterVault({
        userId: user.id,
        amountUsd: parsed.data.amountUsd,
        idempotencyKey: parsed.data.idempotencyKey,
        metadata: parsed.data.metadata
      });
      const master = await deps.vaultService.getMasterVaultSummary({ userId: user.id });
      return res.json({
        ok: true,
        vault: master
      });
    } catch (error) {
      const reason = String(error);
      if (reason.includes("invalid_amount_usd") || reason.includes("invalid_idempotency_key")) {
        return res.status(400).json({ error: "invalid_payload", reason });
      }
      return res.status(500).json({
        error: "vault_master_deposit_failed",
        reason
      });
    }
  });

  app.post("/vaults/master/withdraw", requireAuth, requireVaultProductAccess, async (req, res) => {
    const parsed = masterVaultCashMutationSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return res.status(400).json({
        error: "invalid_payload",
        details: parsed.error.flatten()
      });
    }
    const user = getUserFromLocals(res);
    try {
      const validation = await deps.vaultService.validateMasterVaultWithdraw({
        userId: user.id,
        amountUsd: parsed.data.amountUsd
      });
      if (!validation.ok) {
        return res.status(400).json({
          error: validation.reason ?? "withdraw_not_allowed",
          freeBalance: validation.freeBalance,
          reservedBalance: validation.reservedBalance
        });
      }
      await deps.vaultService.withdrawFromMasterVault({
        userId: user.id,
        amountUsd: parsed.data.amountUsd,
        idempotencyKey: parsed.data.idempotencyKey,
        metadata: parsed.data.metadata
      });
      const master = await deps.vaultService.getMasterVaultSummary({ userId: user.id });
      return res.json({
        ok: true,
        vault: master
      });
    } catch (error) {
      const reason = String(error);
      if (reason.includes("insufficient_free_balance")) {
        return res.status(400).json({ error: "insufficient_free_balance" });
      }
      if (reason.includes("invalid_amount_usd") || reason.includes("invalid_idempotency_key")) {
        return res.status(400).json({ error: "invalid_payload", reason });
      }
      return res.status(500).json({
        error: "vault_master_withdraw_failed",
        reason
      });
    }
  });

  app.get("/vaults/master", requireAuth, requireVaultProductAccess, async (_req, res) => {
    const user = getUserFromLocals(res);
    try {
      const [master, executionMode] = await Promise.all([
        deps.vaultService.getMasterVaultSummary({
          userId: user.id
        }),
        onchainActionService?.getMode?.().catch(() => "offchain_shadow") ?? Promise.resolve("offchain_shadow")
      ]);
      return res.json({
        ...master,
        executionMode
      });
    } catch (error) {
      return res.status(500).json({
        error: "vault_master_fetch_failed",
        reason: String(error)
      });
    }
  });

  app.get("/vaults/bot-templates", requireAuth, requireVaultProductAccess, async (_req, res) => {
    const user = getUserFromLocals(res);
    try {
      const items = await deps.vaultService.listCopyBotTemplates({
        userId: user.id
      });
      return res.json({
        items
      });
    } catch (error) {
      return res.status(500).json({
        error: "vault_bot_templates_fetch_failed",
        reason: String(error)
      });
    }
  });

  app.get("/vaults/bot-vaults", requireAuth, requireVaultProductAccess, async (req, res) => {
    const parsed = botVaultListQuerySchema.safeParse(req.query ?? {});
    if (!parsed.success) {
      return res.status(400).json({
        error: "invalid_query",
        details: parsed.error.flatten()
      });
    }
    const user = getUserFromLocals(res);
    try {
      const items = await deps.vaultService.listBotVaults({
        userId: user.id,
        gridInstanceId: parsed.data.gridInstanceId
      });
      return res.json({ items });
    } catch (error) {
      return res.status(500).json({
        error: "vault_bot_list_failed",
        reason: String(error)
      });
    }
  });

  app.get("/vaults/bot-vaults/:id/ledger", requireAuth, requireVaultProductAccess, async (req, res) => {
    const parsed = ledgerQuerySchema.safeParse(req.query ?? {});
    if (!parsed.success) {
      return res.status(400).json({
        error: "invalid_query",
        details: parsed.error.flatten()
      });
    }
    const user = getUserFromLocals(res);
    try {
      const items = await deps.vaultService.listBotVaultLedger({
        userId: user.id,
        botVaultId: req.params.id,
        limit: parsed.data.limit
      });
      return res.json({ items });
    } catch (error) {
      return res.status(500).json({
        error: "vault_ledger_fetch_failed",
        reason: String(error)
      });
    }
  });

  app.get("/vaults/bot-vaults/:id/fee-events", requireAuth, requireVaultProductAccess, async (req, res) => {
    const parsed = feeEventsQuerySchema.safeParse(req.query ?? {});
    if (!parsed.success) {
      return res.status(400).json({
        error: "invalid_query",
        details: parsed.error.flatten()
      });
    }
    const user = getUserFromLocals(res);
    try {
      const items = await deps.vaultService.listFeeEvents({
        userId: user.id,
        botVaultId: req.params.id,
        limit: parsed.data.limit
      });
      return res.json({ items });
    } catch (error) {
      return res.status(500).json({
        error: "vault_fee_events_fetch_failed",
        reason: String(error)
      });
    }
  });

  app.get("/vaults/bot-vaults/:id/execution-events", requireAuth, requireVaultProductAccess, async (req, res) => {
    const parsed = executionEventsQuerySchema.safeParse(req.query ?? {});
    if (!parsed.success) {
      return res.status(400).json({
        error: "invalid_query",
        details: parsed.error.flatten()
      });
    }
    const user = getUserFromLocals(res);
    try {
      const items = await deps.vaultService.listBotExecutionEvents({
        userId: user.id,
        botVaultId: req.params.id,
        limit: parsed.data.limit
      });
      return res.json({ items });
    } catch (error) {
      return res.status(500).json({
        error: "vault_execution_events_fetch_failed",
        reason: String(error)
      });
    }
  });

  app.get("/vaults/bot-vaults/:id/pnl-report", requireAuth, requireVaultProductAccess, async (req, res) => {
    const parsed = pnlReportQuerySchema.safeParse(req.query ?? {});
    if (!parsed.success) {
      return res.status(400).json({
        error: "invalid_query",
        details: parsed.error.flatten()
      });
    }
    const user = getUserFromLocals(res);
    try {
      const report = await deps.vaultService.getBotVaultPnlReport({
        userId: user.id,
        botVaultId: req.params.id,
        fillsLimit: parsed.data.fillsLimit
      });
      return res.json(report);
    } catch (error) {
      const reason = String(error);
      if (reason.includes("bot_vault_not_found")) {
        return res.status(404).json({ error: "bot_vault_not_found" });
      }
      if (
        reason.includes("bot_vault_report_not_ready")
        || reason.includes("bot_vault_reconciliation_unavailable")
      ) {
        return res.status(409).json({
          error: reason.includes("bot_vault_reconciliation_unavailable")
            ? "bot_vault_reconciliation_unavailable"
            : "bot_vault_report_not_ready"
        });
      }
      return res.status(500).json({
        error: "vault_bot_vault_pnl_report_failed",
        reason
      });
    }
  });

  app.get("/vaults/bot-vaults/:id/audit", requireAuth, requireVaultProductAccess, async (req, res) => {
    const parsed = auditQuerySchema.safeParse(req.query ?? {});
    if (!parsed.success) {
      return res.status(400).json({
        error: "invalid_query",
        details: parsed.error.flatten()
      });
    }
    const user = getUserFromLocals(res);
    try {
      const report = await deps.vaultService.getBotVaultAudit({
        userId: user.id,
        botVaultId: req.params.id,
        limit: parsed.data.limit,
        cursor: parsed.data.cursor
      });
      return res.json(report);
    } catch (error) {
      const reason = String(error);
      if (reason.includes("bot_vault_not_found")) {
        return res.status(404).json({ error: "bot_vault_not_found" });
      }
      return res.status(500).json({
        error: "vault_bot_vault_audit_failed",
        reason
      });
    }
  });

  app.post("/vaults/bot-vaults/:id/close-only", requireAuth, requireVaultProductAccess, async (req, res) => {
    const parsed = closeOnlyMutationSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return res.status(400).json({
        error: "invalid_payload",
        details: parsed.error.flatten()
      });
    }

    const user = getUserFromLocals(res);
    try {
      const botVault = await deps.vaultService.setBotVaultCloseOnly({
        userId: user.id,
        botVaultId: req.params.id,
        reason: parsed.data.reason
      });
      if (!botVault) {
        return res.status(404).json({
          error: "bot_vault_not_found"
        });
      }
      return res.json({
        ok: true,
        botVault
      });
    } catch (error) {
      const mappedRisk = mapRiskErrorToHttp(error);
      if (mappedRisk) {
        return res.status(mappedRisk.status).json({
          error: mappedRisk.code,
          reason: mappedRisk.reason
        });
      }
      const reason = String(error ?? "");
      if (reason.includes("bot_vault_not_found")) {
        return res.status(404).json({
          error: "bot_vault_not_found"
        });
      }
      if (reason.includes("insufficient_")) {
        return res.status(400).json({
          error: reason
        });
      }
      return res.status(500).json({
        error: "vault_bot_close_only_failed",
        reason: String(error)
      });
    }
  });

  app.get("/vaults/profit-share/accruals", requireAuth, requireVaultProductAccess, async (req, res) => {
    const parsed = accrualQuerySchema.safeParse(req.query ?? {});
    if (!parsed.success) {
      return res.status(400).json({
        error: "invalid_query",
        details: parsed.error.flatten()
      });
    }
    const user = getUserFromLocals(res);
    try {
      const items = await deps.vaultService.listProfitShareAccruals({
        userId: user.id,
        botVaultId: parsed.data.botVaultId,
        limit: parsed.data.limit
      });
      return res.json({ items });
    } catch (error) {
      return res.status(500).json({
        error: "vault_profit_share_accruals_fetch_failed",
        reason: String(error)
      });
    }
  });

  app.get("/vaults/onchain/actions", requireAuth, requireVaultProductAccess, async (req, res) => {
    if (!onchainActionService) {
      return res.status(503).json({ error: "onchain_action_service_unavailable" });
    }
    const parsed = onchainActionListQuerySchema.safeParse(req.query ?? {});
    if (!parsed.success) {
      return res.status(400).json({
        error: "invalid_query",
        details: parsed.error.flatten()
      });
    }
    const user = getUserFromLocals(res);
    try {
      const mode = await onchainActionService.getMode();
      const items = await onchainActionService.listActionsForUser({
        userId: user.id,
        limit: parsed.data.limit
      });
      return res.json({ mode, items });
    } catch (error) {
      const mapped = mapOnchainError(error);
      return res.status(mapped.status).json({
        error: mapped.error,
        reason: mapped.reason
      });
    }
  });

  app.post("/vaults/onchain/master/create-tx", requireAuth, requireVaultProductAccess, async (req, res) => {
    if (!onchainActionService) {
      return res.status(503).json({ error: "onchain_action_service_unavailable" });
    }
    const parsed = onchainCreateMasterTxSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return res.status(400).json({
        error: "invalid_payload",
        details: parsed.error.flatten()
      });
    }
    const user = getUserFromLocals(res);
    try {
      const result = await onchainActionService.buildCreateMasterVaultForUser({
        userId: user.id,
        actionKey: parsed.data.actionKey
      });
      return res.json({ ok: true, ...result });
    } catch (error) {
      const mapped = mapOnchainError(error);
      return res.status(mapped.status).json({ error: mapped.error, reason: mapped.reason });
    }
  });

  app.post("/vaults/onchain/master/deposit-tx", requireAuth, requireVaultProductAccess, async (req, res) => {
    if (!onchainActionService) {
      return res.status(503).json({ error: "onchain_action_service_unavailable" });
    }
    const parsed = onchainDepositMasterTxSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return res.status(400).json({
        error: "invalid_payload",
        details: parsed.error.flatten()
      });
    }
    const user = getUserFromLocals(res);
    try {
      const result = await onchainActionService.buildDepositToMasterVault({
        userId: user.id,
        amountUsd: parsed.data.amountUsd,
        actionKey: parsed.data.actionKey
      });
      return res.json({ ok: true, ...result });
    } catch (error) {
      const mapped = mapOnchainError(error);
      return res.status(mapped.status).json({ error: mapped.error, reason: mapped.reason });
    }
  });

  app.post("/vaults/onchain/master/withdraw-tx", requireAuth, requireVaultProductAccess, async (req, res) => {
    if (!onchainActionService) {
      return res.status(503).json({ error: "onchain_action_service_unavailable" });
    }
    const parsed = onchainWithdrawMasterTxSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return res.status(400).json({
        error: "invalid_payload",
        details: parsed.error.flatten()
      });
    }
    const user = getUserFromLocals(res);
    try {
      const result = await onchainActionService.buildWithdrawFromMasterVault({
        userId: user.id,
        amountUsd: parsed.data.amountUsd,
        actionKey: parsed.data.actionKey
      });
      return res.json({ ok: true, ...result });
    } catch (error) {
      const mapped = mapOnchainError(error);
      return res.status(mapped.status).json({ error: mapped.error, reason: mapped.reason });
    }
  });

  app.post("/vaults/onchain/bot-vaults/:id/create-tx", requireAuth, requireVaultProductAccess, async (req, res) => {
    if (!onchainActionService) {
      return res.status(503).json({ error: "onchain_action_service_unavailable" });
    }
    const parsed = onchainCreateBotTxSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return res.status(400).json({
        error: "invalid_payload",
        details: parsed.error.flatten()
      });
    }
    const user = getUserFromLocals(res);
    try {
      const result = await onchainActionService.buildCreateBotVault({
        userId: user.id,
        botVaultId: req.params.id,
        allocationUsd: parsed.data.allocationUsd,
        actionKey: parsed.data.actionKey
      });
      return res.json({ ok: true, ...result });
    } catch (error) {
      const mapped = mapOnchainError(error);
      return res.status(mapped.status).json({ error: mapped.error, reason: mapped.reason });
    }
  });

  app.post("/vaults/onchain/bot-vaults/:id/set-close-only-tx", requireAuth, requireVaultProductAccess, async (req, res) => {
    if (!onchainActionService) {
      return res.status(503).json({ error: "onchain_action_service_unavailable" });
    }
    const parsed = onchainCreateMasterTxSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return res.status(400).json({
        error: "invalid_payload",
        details: parsed.error.flatten()
      });
    }
    const user = getUserFromLocals(res);
    try {
      const result = await onchainActionService.buildSetBotVaultCloseOnly({
        userId: user.id,
        botVaultId: req.params.id,
        actionKey: parsed.data.actionKey
      });
      return res.json({ ok: true, ...result });
    } catch (error) {
      const mapped = mapOnchainError(error);
      return res.status(mapped.status).json({ error: mapped.error, reason: mapped.reason });
    }
  });

  app.post("/vaults/onchain/bot-vaults/:id/claim-tx", requireAuth, requireVaultProductAccess, async (req, res) => {
    if (!onchainActionService) {
      return res.status(503).json({ error: "onchain_action_service_unavailable" });
    }
    const parsed = onchainClaimTxSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return res.status(400).json({
        error: "invalid_payload",
        details: parsed.error.flatten()
      });
    }
    const user = getUserFromLocals(res);
    try {
      const result = await onchainActionService.buildClaimFromBotVault({
        userId: user.id,
        botVaultId: req.params.id,
        releasedReservedUsd: parsed.data.releasedReservedUsd,
        returnedToFreeUsd: parsed.data.returnedToFreeUsd,
        grossReturnedUsd: parsed.data.grossReturnedUsd,
        actionKey: parsed.data.actionKey
      });
      return res.json({ ok: true, ...result });
    } catch (error) {
      const mapped = mapOnchainError(error);
      return res.status(mapped.status).json({ error: mapped.error, reason: mapped.reason });
    }
  });

  app.post("/vaults/onchain/bot-vaults/:id/close-tx", requireAuth, requireVaultProductAccess, async (req, res) => {
    if (!onchainActionService) {
      return res.status(503).json({ error: "onchain_action_service_unavailable" });
    }
    const parsed = onchainCloseTxSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return res.status(400).json({
        error: "invalid_payload",
        details: parsed.error.flatten()
      });
    }
    const user = getUserFromLocals(res);
    try {
      const result = await onchainActionService.buildCloseBotVault({
        userId: user.id,
        botVaultId: req.params.id,
        releasedReservedUsd: parsed.data.releasedReservedUsd,
        returnedToFreeUsd: parsed.data.returnedToFreeUsd,
        grossReturnedUsd: parsed.data.grossReturnedUsd,
        actionKey: parsed.data.actionKey
      });
      return res.json({ ok: true, ...result });
    } catch (error) {
      const mapped = mapOnchainError(error);
      return res.status(mapped.status).json({ error: mapped.error, reason: mapped.reason });
    }
  });

  app.post("/vaults/onchain/actions/:id/submit-tx", requireAuth, requireVaultProductAccess, async (req, res) => {
    if (!onchainActionService) {
      return res.status(503).json({ error: "onchain_action_service_unavailable" });
    }
    const parsed = onchainSubmitTxSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return res.status(400).json({
        error: "invalid_payload",
        details: parsed.error.flatten()
      });
    }
    const user = getUserFromLocals(res);
    try {
      const action = await onchainActionService.submitActionTxHash({
        userId: user.id,
        actionId: req.params.id,
        txHash: parsed.data.txHash
      });
      return res.json({
        ok: true,
        action
      });
    } catch (error) {
      const mapped = mapOnchainError(error);
      return res.status(mapped.status).json({ error: mapped.error, reason: mapped.reason });
    }
  });

  app.get("/wallet/:address/overview", requireAuth, requireVaultProductAccess, async (req, res) => {
    const parsed = walletAddressParamSchema.safeParse(req.params ?? {});
    if (!parsed.success) {
      return res.status(400).json({
        error: "invalid_wallet_address",
        details: parsed.error.flatten()
      });
    }

    try {
      const payload = await walletReadService.getWalletOverview({
        address: parsed.data.address
      });
      return res.json(payload);
    } catch (error) {
      const reason = String(error);
      const status = reason.includes("invalid_wallet_address") ? 400 : 502;
      return res.status(status).json({
        error: status === 400 ? "invalid_wallet_address" : "wallet_overview_fetch_failed",
        reason
      });
    }
  });

  app.get("/wallet/:address/vaults", requireAuth, requireVaultProductAccess, async (req, res) => {
    const parsed = walletAddressParamSchema.safeParse(req.params ?? {});
    if (!parsed.success) {
      return res.status(400).json({
        error: "invalid_wallet_address",
        details: parsed.error.flatten()
      });
    }

    try {
      const payload = await walletReadService.getWalletVaults({
        address: parsed.data.address
      });
      return res.json(payload);
    } catch (error) {
      const reason = String(error);
      const status = reason.includes("invalid_wallet_address") ? 400 : 502;
      return res.status(status).json({
        error: status === 400 ? "invalid_wallet_address" : "wallet_vaults_fetch_failed",
        reason
      });
    }
  });

  app.get("/wallet/:address/activity", requireAuth, requireVaultProductAccess, async (req, res) => {
    const parsedParams = walletAddressParamSchema.safeParse(req.params ?? {});
    const parsedQuery = walletActivityQuerySchema.safeParse(req.query ?? {});
    if (!parsedParams.success || !parsedQuery.success) {
      return res.status(400).json({
        error: "invalid_wallet_activity_request",
        details: {
          params: parsedParams.success ? null : parsedParams.error.flatten(),
          query: parsedQuery.success ? null : parsedQuery.error.flatten()
        }
      });
    }

    try {
      const payload = await walletReadService.getWalletActivity({
        address: parsedParams.data.address,
        limit: parsedQuery.data.limit
      });
      return res.json(payload);
    } catch (error) {
      const reason = String(error);
      const status = reason.includes("invalid_wallet_address") ? 400 : 502;
      return res.status(status).json({
        error: status === 400 ? "invalid_wallet_address" : "wallet_activity_fetch_failed",
        reason
      });
    }
  });

  app.get("/funding/:address/overview", requireAuth, async (req, res) => {
    const parsed = walletAddressParamSchema.safeParse(req.params ?? {});
    if (!parsed.success) {
      return res.status(400).json({
        error: "invalid_wallet_address",
        details: parsed.error.flatten()
      });
    }

    try {
      const payload = await fundingReadService.getFundingOverview({
        address: parsed.data.address
      });
      return res.json(payload);
    } catch (error) {
      const reason = String(error);
      const status = reason.includes("invalid_wallet_address") ? 400 : 502;
      return res.status(status).json({
        error: status === 400 ? "invalid_wallet_address" : "funding_overview_fetch_failed",
        reason
      });
    }
  });

  app.get("/funding/:address/readiness", requireAuth, async (req, res) => {
    const parsed = walletAddressParamSchema.safeParse(req.params ?? {});
    if (!parsed.success) {
      return res.status(400).json({
        error: "invalid_wallet_address",
        details: parsed.error.flatten()
      });
    }

    try {
      const payload = await fundingReadService.getFundingReadiness({
        address: parsed.data.address
      });
      return res.json(payload);
    } catch (error) {
      const reason = String(error);
      const status = reason.includes("invalid_wallet_address") ? 400 : 502;
      return res.status(status).json({
        error: status === 400 ? "invalid_wallet_address" : "funding_readiness_fetch_failed",
        reason
      });
    }
  });

  app.get("/funding/:address/history", requireAuth, async (req, res) => {
    const parsed = walletAddressParamSchema.safeParse(req.params ?? {});
    if (!parsed.success) {
      return res.status(400).json({
        error: "invalid_wallet_address",
        details: parsed.error.flatten()
      });
    }

    const user = getUserFromLocals(res);

    try {
      const actions = onchainActionService
        ? await onchainActionService.listActionsForUser({
            userId: user.id,
            limit: 50
          })
        : [];
      const payload = await fundingReadService.getFundingHistory({
        address: parsed.data.address,
        items: actions
      });
      return res.json(payload);
    } catch (error) {
      const reason = String(error);
      const status = reason.includes("invalid_wallet_address") ? 400 : 502;
      return res.status(status).json({
        error: status === 400 ? "invalid_wallet_address" : "funding_history_fetch_failed",
        reason
      });
    }
  });

  app.get("/funding/:address/external-links", requireAuth, async (req, res) => {
    const parsed = walletAddressParamSchema.safeParse(req.params ?? {});
    if (!parsed.success) {
      return res.status(400).json({
        error: "invalid_wallet_address",
        details: parsed.error.flatten()
      });
    }

    try {
      const payload = await fundingReadService.getFundingExternalLinks({
        address: parsed.data.address
      });
      return res.json(payload);
    } catch (error) {
      const reason = String(error);
      const status = reason.includes("invalid_wallet_address") ? 400 : 502;
      return res.status(status).json({
        error: status === 400 ? "invalid_wallet_address" : "funding_external_links_fetch_failed",
        reason
      });
    }
  });

  app.get("/transfers/:address/overview", requireAuth, async (req, res) => {
    const parsed = walletAddressParamSchema.safeParse(req.params ?? {});
    if (!parsed.success) {
      return res.status(400).json({
        error: "invalid_wallet_address",
        details: parsed.error.flatten()
      });
    }

    try {
      const payload = await transferReadService.getTransferOverview({
        address: parsed.data.address
      });
      return res.json(payload);
    } catch (error) {
      const reason = String(error);
      const status = reason.includes("invalid_wallet_address") ? 400 : 502;
      return res.status(status).json({
        error: status === 400 ? "invalid_wallet_address" : "transfer_overview_fetch_failed",
        reason
      });
    }
  });

  app.get("/vaults/:vaultAddress", requireAuth, requireVaultProductAccess, async (req, res) => {
    const parsedParams = vaultAddressParamSchema.safeParse(req.params ?? {});
    const parsedQuery = vaultDetailQuerySchema.safeParse(req.query ?? {});
    if (!parsedParams.success || !parsedQuery.success) {
      return res.status(400).json({
        error: "invalid_vault_request",
        details: {
          params: parsedParams.success ? null : parsedParams.error.flatten(),
          query: parsedQuery.success ? null : parsedQuery.error.flatten()
        }
      });
    }

    try {
      const payload = await walletReadService.getVaultDetails({
        vaultAddress: parsedParams.data.vaultAddress,
        userAddress: parsedQuery.data.user
      });
      return res.json(payload);
    } catch (error) {
      const reason = String(error);
      const status = reason.includes("invalid_vault_address") ? 400 : 502;
      return res.status(status).json({
        error: status === 400 ? "invalid_vault_address" : "vault_detail_fetch_failed",
        reason
      });
    }
  });
}
