import type { Express } from "express";
import { getUserFromLocals, requireAuth } from "../auth.js";
import { buildGridMinimumInvestmentErrorResponse, buildGridPreviewResponse } from "./previewValidation.js";

export function registerGridInstanceRoutes(app: Express, deps: any, shared: any) {
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

  app.post("/grid/templates/:id/instance-preview", requireAuth, async (req, res) => {
    if (!(await shared.requireGridFeatureEnabledOrRespond(res))) return;
    if (!(await shared.requireGridCapabilityOrRespond(res, deps))) return;
    const parsed = shared.gridInstancePreviewSchema.safeParse(req.body ?? {});
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

      const templateMarginPolicy = String(template.marginPolicy ?? (template.allowAutoMargin ? "AUTO_ALLOWED" : "MANUAL_ONLY"));
      const requestedMarginMode = parsed.data.marginMode ?? (parsed.data.autoMarginEnabled ? "AUTO" : "MANUAL");
      if (requestedMarginMode === "AUTO" && templateMarginPolicy !== "AUTO_ALLOWED") {
        return res.status(400).json({ error: "grid_template_auto_margin_not_allowed" });
      }
      const autoMarginEnabled = requestedMarginMode === "AUTO";

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
        && hyperliquidUsage.usesHyperliquid;

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
        && hyperliquidUsage.usesHyperliquid;

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

      const normalizedTemplate = shared.mapGridTemplateRow(template);
      const botName = parsed.data.name?.trim() || `${template.name} (${template.symbol})`;
      let createdInstanceId: string | null = null;
      let createdBotId: string | null = null;
      let createdBotVaultId: string | null = null;
      const createProvisioningKey = String(parsed.data.idempotencyKey ?? "").trim()
        || `grid_create:${user.id}:${account.id}:${Date.now()}`;
      await deps.db.$transaction(async (tx: any) => {
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
        createdBotId = String(bot.id);

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
            stateJson: useUnifiedHyperVaultCreateFlow
              ? {
                  provisioning: {
                    phase: "pending_signature",
                    reason: "awaiting_wallet_signature",
                    idempotencyKey: createProvisioningKey,
                    startedAt: new Date().toISOString()
                  }
                }
              : {},
            metricsJson: {}
          }
        });
        createdInstanceId = String(createdInstance.id);

        const botVault = await deps.vaultService.ensureBotVaultForGridInstance({
          tx,
          userId: user.id,
          gridInstanceId: createdInstance.id,
          allocatedUsd: Number(createdInstance.investUsd ?? 0) + Number(createdInstance.extraMarginUsd ?? 0),
          deferReservation: useUnifiedHyperVaultCreateFlow,
          idempotencyKey: `${createProvisioningKey}:bot_vault`,
          metadata: useUnifiedHyperVaultCreateFlow
            ? {
                sourceType: "grid_instance_create_pending_onchain",
                provisioningPhase: "pending_signature",
                createIdempotencyKey: createProvisioningKey
              }
            : undefined
        });
        createdBotVaultId = String(botVault.id);
      });

      if (!createdInstanceId || !createdBotId || !createdBotVaultId) {
        return res.status(500).json({ error: "grid_instance_create_failed", reason: "instance_not_found_post_create" });
      }

      if (useUnifiedHyperVaultCreateFlow) {
        if (!deps.onchainActionService) {
          return res.status(503).json({ error: "onchain_action_service_unavailable" });
        }
        const totalAllocationUsd = Number(computed.allocation.gridInvestUsd ?? 0) + Number(computed.allocation.extraMarginUsd ?? 0);
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
      const mappedRisk = shared.mapRiskErrorToHttp(error);
      if (mappedRisk) {
        return res.status(mappedRisk.status).json({
          error: mappedRisk.code,
          reason: mappedRisk.reason
        });
      }
      if (shared.isMissingTableError(error)) return res.status(503).json({ error: "grid_schema_not_ready" });
      return res.status(500).json({ error: "grid_instance_create_failed", reason: String(error) });
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
        return state !== "archived";
      });
      const vaultByInstanceId = await deps.loadBotVaultByInstanceIds(deps.db, filteredRows.map((row: any) => row.id));
      return res.json({
        items: filteredRows.map((row: any) =>
          shared.mapGridInstanceRow({
            ...row,
            botVault: vaultByInstanceId.get(row.id) ?? null
          }, {
            includeProviderMetadataRaw: false,
            currentPilotAccess
          })
        )
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
      const archived = await deps.gridLifecycle.archiveGridInstance({
        row,
        userId: user.id,
        reason: "manual_stop",
        closeSourceType: "grid_instance_stop_final"
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
      if (shared.isMissingTableError(error)) return res.status(503).json({ error: "grid_schema_not_ready" });
      return res.status(500).json({ error: "grid_instance_stop_failed", reason: String(error) });
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
            await deps.vaultService.topUpBotVaultForGridInstance({
              tx,
              userId: user.id,
              gridInstanceId: String(row.id),
              amountUsd: topUpDeltaUsd,
              idempotencyKey: `grid_instance:${row.id}:margin_add:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`,
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
        await deps.vaultService.topUpBotVaultForGridInstance({
          tx,
          userId: user.id,
          gridInstanceId: String(row.id),
          amountUsd: parsed.data.amountUsd,
          idempotencyKey: `grid_instance:${row.id}:margin_add:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`,
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
      const marginMode = String(row.marginMode ?? (row.autoMarginEnabled ? "AUTO" : "MANUAL"));
      if (marginMode === "AUTO") {
        const currentTotalBudget = shared.toTwoDecimals(Number(row.investUsd ?? 0) + Number(row.extraMarginUsd ?? 0));
        const nextTotalBudget = shared.toTwoDecimals(Math.max(0.01, currentTotalBudget - parsed.data.amountUsd));
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

        const updated = await deps.db.gridBotInstance.update({
          where: { id: row.id },
          data: {
            investUsd: computed.allocation.gridInvestUsd,
            extraMarginUsd: computed.allocation.extraMarginUsd
          }
        });
        return res.json({
          ok: true,
          id: updated.id,
          investUsd: updated.investUsd,
          extraMarginUsd: updated.extraMarginUsd
        });
      }
      const current = Number(row.extraMarginUsd ?? 0);
      const next = Math.max(0, current - parsed.data.amountUsd);
      const updated = await deps.db.gridBotInstance.update({
        where: { id: row.id },
        data: { extraMarginUsd: next }
      });
      return res.json({
        ok: true,
        id: updated.id,
        investUsd: updated.investUsd,
        extraMarginUsd: updated.extraMarginUsd
      });
    } catch (error) {
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
      return res.json({ items });
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
      return res.json({ items });
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
