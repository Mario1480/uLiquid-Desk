import express from "express";
import { z } from "zod";
import type { CapabilityKey, PlanCapabilities, PlanTier } from "@mm/core";
import { getUserFromLocals, requireAuth } from "../auth.js";
import {
  isPositionCopilotRuntimeEnabled,
  isPositionMonitoringRuntimeEnabled
} from "../ai/featureFlags.js";
import type { AiChatResult, CallAiChatOptions, ChatMessage } from "../ai/provider.js";
import {
  buildPositionCopilotSnapshot,
  shouldNotifyForPositionCopilot,
  type PositionCopilotTriggerState
} from "./core.js";
import { analyzePositionSnapshot } from "./service.js";
import {
  loadPositionCopilotSettings,
  savePositionCopilotSettings
} from "./settings.js";

type CallAiChat = (messages: ChatMessage[], options: CallAiChatOptions) => Promise<AiChatResult>;

type RegisterPositionCopilotRoutesDeps = {
  db: any;
  callAiChat: CallAiChat;
  dispatchPositionCopilotNotification(payload: {
    userId: string;
    title: string;
    message: string;
    severity: "info" | "warn" | "error" | "critical";
    exchange: string;
    exchangeAccountId: string;
    symbol: string;
    routeTab: "positions";
    tags: string[];
  }): Promise<void>;
  resolvePlanCapabilitiesForUserId(input: {
    userId: string;
  }): Promise<{ plan: PlanTier; capabilities: PlanCapabilities }>;
  isCapabilityAllowed(capabilities: PlanCapabilities, capability: CapabilityKey): boolean;
  sendCapabilityDenied(
    res: express.Response,
    params: { capability: CapabilityKey; currentPlan: PlanTier; legacyCode?: string }
  ): express.Response;
  hasAdminBackendAccess?: (user: { id: string; email: string }) => Promise<boolean>;
};

const settingsSchema = z.object({
  mode: z.enum(["critical_only", "important_changes", "periodic_summary", "off"]),
  inAppEnabled: z.boolean(),
  telegramEnabled: z.boolean(),
  cooldownMinutes: z.number().int().min(5).max(240),
  periodicMinutes: z.number().int().min(15).max(1440)
}).strict();

const snapshotSchema = z.object({
  exchangeAccountId: z.string().trim().min(1).max(100),
  marketType: z.enum(["spot", "perp"]),
  symbol: z.string().trim().min(1).max(40),
  side: z.enum(["long", "short"]),
  size: z.number().finite().positive(),
  entryPrice: z.number().finite().positive().nullable(),
  markPrice: z.number().finite().positive().nullable(),
  unrealizedPnlUsd: z.number().finite().nullable(),
  leverage: z.number().finite().positive().nullable(),
  marginMode: z.enum(["isolated", "cross"]).nullable(),
  marginUsd: z.number().finite().positive().nullable(),
  notionalUsd: z.number().finite().positive().nullable(),
  liquidationPrice: z.number().finite().positive().nullable(),
  liquidationDistancePct: z.number().finite().nullable(),
  roePct: z.number().finite().nullable(),
  pnlPct: z.number().finite().nullable(),
  stopLossPrice: z.number().finite().positive().nullable(),
  takeProfitPrice: z.number().finite().positive().nullable(),
  dataDegraded: z.boolean(),
  observedAt: z.string().datetime()
}).strict();

const analyzeSchema = z.object({
  trigger: z.enum(["manual", "event", "periodic"]).default("manual"),
  language: z.enum(["de", "en"]).default("en"),
  snapshot: snapshotSchema
}).strict();

function normalizeSymbol(value: string): string {
  return value.replace(/[^A-Za-z0-9]/g, "").toUpperCase().slice(0, 40);
}

function triggerKey(userId: string, snapshot: { exchangeAccountId: string; marketType: string; symbol: string; side: string }): string {
  return [
    "positionCopilot.trigger.v1",
    userId,
    snapshot.exchangeAccountId,
    snapshot.marketType,
    normalizeSymbol(snapshot.symbol),
    snapshot.side
  ].join(":");
}

function parseTriggerState(value: unknown): PositionCopilotTriggerState {
  const record = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  const lastNotifiedAt = typeof record.lastNotifiedAt === "string" && Number.isFinite(Date.parse(record.lastNotifiedAt))
    ? new Date(record.lastNotifiedAt)
    : null;
  const previousRiskLevel = record.previousRiskLevel === "low"
    || record.previousRiskLevel === "medium"
    || record.previousRiskLevel === "high"
    || record.previousRiskLevel === "critical"
    ? record.previousRiskLevel
    : null;
  return {
    previousSnapshotHash: typeof record.previousSnapshotHash === "string" ? record.previousSnapshotHash : null,
    previousRiskLevel,
    lastNotifiedAt
  };
}

function notificationSeverity(riskLevel: string): "info" | "warn" | "error" | "critical" {
  if (riskLevel === "critical") return "critical";
  if (riskLevel === "high") return "error";
  if (riskLevel === "medium") return "warn";
  return "info";
}

export function registerPositionCopilotRoutes(app: express.Express, deps: RegisterPositionCopilotRoutesDeps) {
  function requireRuntimeGateOrRespond(
    res: express.Response,
    feature: "copilot" | "monitoring"
  ): boolean {
    const enabled = feature === "copilot"
      ? isPositionCopilotRuntimeEnabled()
      : isPositionMonitoringRuntimeEnabled();
    if (enabled) return true;
    res.status(403).json({
      error: feature === "copilot"
        ? "position_copilot_feature_disabled"
        : "position_monitoring_feature_disabled"
    });
    return false;
  }

  async function requireCapabilityOrRespond(
    res: express.Response,
    capability: "product.ai_position_copilot" | "product.ai_position_monitoring"
  ): Promise<boolean> {
    const user = getUserFromLocals(res);
    if (deps.hasAdminBackendAccess && (await deps.hasAdminBackendAccess(user))) return true;
    const capabilityContext = await deps.resolvePlanCapabilitiesForUserId({ userId: user.id });
    if (deps.isCapabilityAllowed(capabilityContext.capabilities, capability)) return true;
    deps.sendCapabilityDenied(res, {
      capability,
      currentPlan: capabilityContext.plan,
      legacyCode: capability === "product.ai_position_copilot"
        ? "position_copilot_not_available"
        : "position_monitoring_not_available"
    });
    return false;
  }

  app.get("/api/position-copilot/settings", requireAuth, async (_req, res) => {
    if (!requireRuntimeGateOrRespond(res, "copilot")) return;
    if (!(await requireCapabilityOrRespond(res, "product.ai_position_copilot"))) return;
    try {
      const user = getUserFromLocals(res);
      return res.json(await loadPositionCopilotSettings(deps.db, user.id));
    } catch (error) {
      return res.status(500).json({ error: "position_copilot_settings_failed", reason: String(error) });
    }
  });

  app.put("/api/position-copilot/settings", requireAuth, async (req, res) => {
    if (!requireRuntimeGateOrRespond(res, "copilot")) return;
    if (!(await requireCapabilityOrRespond(res, "product.ai_position_copilot"))) return;
    const parsed = settingsSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return res.status(400).json({ error: "invalid_payload", details: parsed.error.flatten() });
    }
    if (parsed.data.mode !== "off") {
      if (!requireRuntimeGateOrRespond(res, "monitoring")) return;
      if (!(await requireCapabilityOrRespond(res, "product.ai_position_monitoring"))) return;
    }
    try {
      const user = getUserFromLocals(res);
      return res.json(await savePositionCopilotSettings(deps.db, user.id, parsed.data));
    } catch (error) {
      return res.status(500).json({ error: "position_copilot_settings_update_failed", reason: String(error) });
    }
  });

  app.post("/api/position-copilot/analyze", requireAuth, async (req, res) => {
    if (!requireRuntimeGateOrRespond(res, "copilot")) return;
    if (!(await requireCapabilityOrRespond(res, "product.ai_position_copilot"))) return;
    const parsed = analyzeSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return res.status(400).json({ error: "invalid_payload", details: parsed.error.flatten() });
    }
    if (parsed.data.trigger !== "manual") {
      if (!requireRuntimeGateOrRespond(res, "monitoring")) return;
      if (!(await requireCapabilityOrRespond(res, "product.ai_position_monitoring"))) return;
    }

    const user = getUserFromLocals(res);
    const account = await deps.db.exchangeAccount.findFirst({
      where: { id: parsed.data.snapshot.exchangeAccountId, userId: user.id },
      select: { id: true, exchange: true, label: true }
    });
    if (!account) return res.status(404).json({ error: "exchange_account_not_found" });

    try {
      const symbol = normalizeSymbol(parsed.data.snapshot.symbol);
      const copierTrade = await deps.db.botTradeHistory.findFirst({
        where: {
          userId: user.id,
          exchangeAccountId: account.id,
          symbol,
          marketType: parsed.data.snapshot.marketType,
          status: "open",
          predictionStateId: { not: null }
        },
        select: { id: true }
      }).catch(() => null);
      const snapshot = buildPositionCopilotSnapshot({
        ...parsed.data.snapshot,
        symbol,
        exchange: account.exchange,
        openedByPredictionCopier: Boolean(copierTrade)
      });
      const settings = await loadPositionCopilotSettings(deps.db, user.id);

      if (parsed.data.trigger !== "manual" && settings.mode === "off") {
        return res.json({ skipped: true, reason: "automatic_analysis_off", settings });
      }

      const startedAt = Date.now();
      const result = await analyzePositionSnapshot({
        snapshot,
        userId: user.id,
        language: parsed.data.language,
        callAiChat: deps.callAiChat
      });
      const now = new Date();
      let notification = { sent: false, reason: "manual_analysis" };

      if (parsed.data.trigger !== "manual") {
        const key = triggerKey(user.id, snapshot);
        const stored = await deps.db.globalSetting.findUnique({ where: { key }, select: { value: true } });
        const state = parseTriggerState(stored?.value);
        const decision = shouldNotifyForPositionCopilot({
          mode: settings.mode,
          analysis: result.analysis,
          state,
          now,
          cooldownMs: settings.cooldownMinutes * 60_000,
          periodicMs: settings.periodicMinutes * 60_000
        });
        const nextState = {
          previousSnapshotHash: result.analysis.snapshotHash,
          previousRiskLevel: result.analysis.riskLevel,
          lastNotifiedAt: decision.notify ? now.toISOString() : state.lastNotifiedAt?.toISOString() ?? null
        };
        await deps.db.globalSetting.upsert({
          where: { key },
          update: { value: nextState },
          create: { key, value: nextState }
        });
        notification = { sent: decision.notify && settings.telegramEnabled, reason: decision.reason };
        if (decision.notify && settings.telegramEnabled) {
          await deps.dispatchPositionCopilotNotification({
            userId: user.id,
            title: `Position Copilot · ${symbol}`,
            message: result.analysis.summary,
            severity: notificationSeverity(result.analysis.riskLevel),
            exchange: account.exchange,
            exchangeAccountId: account.id,
            symbol,
            routeTab: "positions",
            tags: ["position-copilot", `risk:${result.analysis.riskLevel}`, "read-only"]
          });
        }
      }

      await deps.db.aiTraceLog.create({
        data: {
          userId: user.id,
          scope: "position_copilot",
          provider: result.provider,
          model: result.model,
          symbol,
          marketType: snapshot.marketType,
          userPayload: { trigger: parsed.data.trigger, snapshot },
          parsedResponse: result.analysis,
          success: true,
          fallbackUsed: result.fallbackUsed,
          cacheHit: result.cacheHit,
          rateLimited: result.rateLimited,
          latencyMs: Date.now() - startedAt
        }
      }).catch(() => undefined);

      return res.json({
        skipped: false,
        analysis: result.analysis,
        metadata: {
          cacheHit: result.cacheHit,
          fallbackUsed: result.fallbackUsed,
          rateLimited: result.rateLimited,
          fallbackReason: result.fallbackReason,
          notification
        },
        settings
      });
    } catch (error) {
      return res.status(500).json({ error: "position_copilot_analysis_failed", reason: String(error) });
    }
  });
}
