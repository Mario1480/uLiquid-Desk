import express from "express";
import { z } from "zod";
import { getUserFromLocals, requireAuth } from "../auth.js";

type PredictionTimeframe = "5m" | "15m" | "1h" | "4h" | "1d";
type PredictionMarketType = "spot" | "perp";
type PredictionSignal = "up" | "down" | "neutral";
type PredictionStrategyRef = {
  kind: "ai" | "local" | "composite";
  id: string;
  name: string | null;
};

const predictionGenerateSchema = z.object({
  symbol: z.string().trim().min(1),
  marketType: z.enum(["spot", "perp"]),
  timeframe: z.enum(["5m", "15m", "1h", "4h", "1d"]),
  tsCreated: z.string().datetime().optional(),
  prediction: z.object({
    signal: z.enum(["up", "down", "neutral"]),
    expectedMovePct: z.number(),
    confidence: z.number()
  }),
  featureSnapshot: z.record(z.any()),
  botId: z.string().trim().min(1).optional(),
  modelVersionBase: z.string().trim().min(1).optional(),
  signalMode: z.enum(["local_only", "ai_only", "both"]).default("both"),
  aiPromptTemplateId: z.string().trim().min(1).max(128).nullish(),
  compositeStrategyId: z.string().trim().min(1).max(160).nullish(),
  strategyRef: z.object({
    kind: z.enum(["ai", "local", "composite"]),
    id: z.string().trim().min(1).max(160)
  }).nullish()
});

const predictionGenerateAutoSchema = z.object({
  exchangeAccountId: z.string().trim().min(1),
  symbol: z.string().trim().min(1),
  marketType: z.enum(["spot", "perp"]),
  timeframe: z.enum(["5m", "15m", "1h", "4h", "1d"]),
  leverage: z.number().int().min(1).max(125).optional(),
  modelVersionBase: z.string().trim().min(1).optional(),
  aiPromptTemplateId: z.string().trim().min(1).max(128).nullish(),
  compositeStrategyId: z.string().trim().min(1).max(160).nullish(),
  strategyRef: z.object({
    kind: z.enum(["ai", "local", "composite"]),
    id: z.string().trim().min(1).max(160)
  }).nullish()
});

export type RegisterPredictionGenerateRoutesDeps = {
  db: any;
  isSuperadminEmail(email: string): boolean;
  normalizePredictionSignalMode(value: unknown): "local_only" | "ai_only" | "both";
  asRecord(value: unknown): Record<string, any>;
  normalizeExchangeValue(value: string): string;
  normalizeSymbolInput(value: string | null | undefined): string | null;
  normalizePredictionStrategyKind(value: unknown): "ai" | "local" | "composite" | null;
  getEnabledLocalStrategyById(id: string): Promise<any>;
  getEnabledCompositeStrategyById(id: string): Promise<any>;
  resolveStrategyBoundSignalMode(
    requestedSignalMode: "local_only" | "ai_only" | "both",
    strategyKind: "ai" | "local" | "composite"
  ): "local_only" | "ai_only" | "both";
  resolvePredictionLimitBucketFromStrategy(input: {
    strategyRef?: PredictionStrategyRef | null;
    signalMode?: "local_only" | "ai_only" | "both";
  }): string;
  resolveUserContext(user: { id: string; email: string }): Promise<any>;
  resolveStrategyEntitlementsForUser(user: { id: string; email: string }): Promise<any>;
  resolveAiPromptRuntimeForUserSelection(input: any): Promise<any>;
  isStrategyFeatureEnabledForUser(user: { id: string; email: string }): Promise<boolean>;
  evaluateStrategySelectionAccess(input: any): any;
  getAiModelAsync(): Promise<string | null>;
  countCompositeStrategyNodes(strategy: any): number | null;
  evaluateAiPromptAccess(input: any): { allowed: boolean; reason: string; mode: string; wouldBlock: boolean };
  getAiPromptRuntimeSettings(context: any): Promise<any>;
  normalizePromptTimeframeSetForRuntime(settings: any, timeframe: PredictionTimeframe): { runTimeframe: PredictionTimeframe; timeframes: PredictionTimeframe[] };
  readPrefillExchangeAccountId(snapshot: Record<string, any>): string | null;
  findPredictionStateIdByScope(input: any): Promise<string | null>;
  isAutoScheduleEnabled(value: unknown): boolean;
  canCreatePredictionForUser(input: any): Promise<any>;
  withStrategyRunSnapshot(snapshot: Record<string, any>, run: any, meta?: any): Record<string, any>;
  resolvePreferredSignalSourceForMode(
    signalMode: "local_only" | "ai_only" | "both",
    fallback: "local" | "ai"
  ): "local" | "ai";
  PREDICTION_PRIMARY_SIGNAL_SOURCE: "local" | "ai";
  normalizeTagList(value: unknown): string[];
  resolveStrategyNewsRiskMode(input: any): string;
  readGlobalNewsRiskEnforcement(): Promise<boolean>;
  shouldBlockByNewsRisk(input: any): boolean;
  derivePredictionTrackingFromSnapshot(snapshot: Record<string, any>, timeframe: PredictionTimeframe): any;
  generateAndPersistPrediction(input: any): Promise<any>;
  enforceNewsRiskTag(tags: string[] | null | undefined, featureSnapshot: Record<string, any>): string[];
  normalizeKeyDriverList(value: unknown): Array<Record<string, unknown>>;
  buildPredictionChangeHash(input: any): string;
  readPredictionStrategyRef(snapshot: Record<string, any>): PredictionStrategyRef | null;
  toPredictionStateStrategyScope(strategyRef: PredictionStrategyRef | null): Record<string, any>;
  timeframeToIntervalMs(timeframe: PredictionTimeframe): number;
  isAutoSchedulePaused(snapshot: Record<string, any>): boolean;
  parseDirectionPreference(value: unknown): "long" | "short" | "either";
  readConfidenceTarget(snapshot: Record<string, any>): number;
  readRequestedLeverage(snapshot: Record<string, any>): number | undefined;
  persistPredictionState(input: any): Promise<any>;
  dispatchTradablePredictionNotification(input: any): Promise<void>;
  resolveNotificationStrategyName(input: any): string | null;
  readAiPromptMarketAnalysisUpdateEnabled(snapshot: Record<string, any>): boolean;
  dispatchMarketAnalysisUpdateNotification(input: any): Promise<void>;
  readAiPromptTemplateId(snapshot: Record<string, any>): string | null;
  readAiPromptTemplateName(snapshot: Record<string, any>): string | null;
  readLocalStrategyId(snapshot: Record<string, any>): string | null;
  readLocalStrategyName(snapshot: Record<string, any>): string | null;
  readCompositeStrategyId(snapshot: Record<string, any>): string | null;
  readCompositeStrategyName(snapshot: Record<string, any>): string | null;
  generateAutoPredictionForUser(userId: string, payload: any, context: any): Promise<any>;
  sendManualTradingError(res: express.Response, error: unknown): express.Response;
};

export function registerPredictionGenerateRoutes(
  app: express.Express,
  deps: RegisterPredictionGenerateRoutesDeps
) {
  app.post("/api/predictions/generate", requireAuth, async (req, res) => {
    const user = getUserFromLocals(res);
    const requestIsSuperadmin = deps.isSuperadminEmail(user.email);
    const parsed = predictionGenerateSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "invalid_payload", details: parsed.error.flatten() });
    }

    const payload = parsed.data;
    const requestedSignalMode = deps.normalizePredictionSignalMode(payload.signalMode);
    const tsCreated = payload.tsCreated ?? new Date().toISOString();
    const inputFeatureSnapshot = deps.asRecord(payload.featureSnapshot);
    const promptScopeContext = {
      exchange:
        typeof inputFeatureSnapshot.prefillExchange === "string"
          ? deps.normalizeExchangeValue(inputFeatureSnapshot.prefillExchange)
          : null,
      accountId:
        typeof inputFeatureSnapshot.prefillExchangeAccountId === "string"
          ? inputFeatureSnapshot.prefillExchangeAccountId.trim()
          : null,
      symbol: deps.normalizeSymbolInput(payload.symbol) ?? payload.symbol,
      timeframe: payload.timeframe
    };
    const payloadStrategyKind = deps.normalizePredictionStrategyKind(payload.strategyRef?.kind);
    const payloadStrategyId =
      typeof payload.strategyRef?.id === "string" && payload.strategyRef.id.trim()
        ? payload.strategyRef.id.trim()
        : null;
    const requestedPromptTemplateId =
      payloadStrategyKind === "ai"
        ? payloadStrategyId
        : (typeof payload.aiPromptTemplateId === "string" && payload.aiPromptTemplateId.trim()
            ? payload.aiPromptTemplateId.trim()
            : null);
    const requestedLocalStrategyId = payloadStrategyKind === "local" ? payloadStrategyId : null;
    const requestedCompositeStrategyId =
      payloadStrategyKind === "composite"
        ? payloadStrategyId
        : (typeof payload.compositeStrategyId === "string" && payload.compositeStrategyId.trim()
            ? payload.compositeStrategyId.trim()
            : null);
    const selectedLocalStrategy = requestedLocalStrategyId
      ? await deps.getEnabledLocalStrategyById(requestedLocalStrategyId)
      : null;
    const selectedCompositeStrategy = requestedCompositeStrategyId
      ? await deps.getEnabledCompositeStrategyById(requestedCompositeStrategyId)
      : null;
    let selectedStrategyRef: PredictionStrategyRef | null =
      selectedCompositeStrategy
        ? { kind: "composite", id: selectedCompositeStrategy.id, name: selectedCompositeStrategy.name }
        : selectedLocalStrategy
          ? { kind: "local", id: selectedLocalStrategy.id, name: selectedLocalStrategy.name }
          : requestedPromptTemplateId
            ? { kind: "ai", id: requestedPromptTemplateId, name: null }
            : null;
    const signalMode = deps.resolveStrategyBoundSignalMode(
      requestedSignalMode,
      selectedStrategyRef?.kind ?? "ai"
    );
    if (requestedLocalStrategyId && !selectedLocalStrategy) {
      return res.status(400).json({ error: "invalid_local_strategy" });
    }
    if (requestedCompositeStrategyId && !selectedCompositeStrategy) {
      return res.status(400).json({ error: "invalid_composite_strategy" });
    }
    const userCtx = await deps.resolveUserContext(user);
    const strategyEntitlements = await deps.resolveStrategyEntitlementsForUser(user);
    const requestedPromptSelection = requestedPromptTemplateId
      ? await deps.resolveAiPromptRuntimeForUserSelection({
          userId: user.id,
          templateId: requestedPromptTemplateId,
          context: promptScopeContext,
          requirePublicGlobalPrompt: !requestIsSuperadmin
        })
      : null;
    if (requestedPromptTemplateId && !requestedPromptSelection) {
      return res.status(400).json({ error: "invalid_ai_prompt_template" });
    }
    const selectedPromptIsOwn = Boolean(requestedPromptSelection?.isOwnTemplate);
    if (selectedPromptIsOwn && !(await deps.isStrategyFeatureEnabledForUser(user))) {
      return res.status(403).json({ error: "forbidden" });
    }
    if (selectedStrategyRef?.kind === "ai" && requestedPromptSelection?.templateName) {
      selectedStrategyRef = {
        ...selectedStrategyRef,
        name: requestedPromptSelection.templateName
      };
    }
    const selectedKind: "ai" | "local" | "composite" = selectedStrategyRef?.kind ?? "ai";
    const predictionLimitBucket = deps.resolvePredictionLimitBucketFromStrategy({
      strategyRef: selectedStrategyRef,
      signalMode
    });
    const normalizedSymbol = deps.normalizeSymbolInput(payload.symbol) ?? payload.symbol;
    const selectedId =
      selectedStrategyRef?.id ??
      (selectedKind === "ai" ? (selectedPromptIsOwn ? null : (requestedPromptTemplateId ?? "default")) : null);
    const strategyAccess = deps.evaluateStrategySelectionAccess({
      entitlements: strategyEntitlements,
      kind: selectedKind,
      strategyId: selectedId,
      aiModel: selectedKind === "ai" ? await deps.getAiModelAsync() : null,
      compositeNodes: selectedKind === "composite" ? deps.countCompositeStrategyNodes(selectedCompositeStrategy) : null
    });
    if (!strategyAccess.allowed) {
      return res.status(403).json({
        error: "strategy_license_blocked",
        reason: strategyAccess.reason,
        maxCompositeNodes: strategyAccess.maxCompositeNodes
      });
    }
    const promptLicenseDecision = selectedPromptIsOwn
      ? { allowed: true, reason: "ok" as const, mode: "off" as const, wouldBlock: false }
      : deps.evaluateAiPromptAccess({
          userId: user.id,
          selectedPromptId: requestedPromptTemplateId
        });
    if (!promptLicenseDecision.allowed) {
      return res.status(403).json({ error: "ai_prompt_license_blocked" });
    }
    if (promptLicenseDecision.wouldBlock) {
      console.warn("[license] ai prompt selection would be blocked in enforce mode", {
        userId: user.id,
        selectedPromptId: requestedPromptTemplateId,
        mode: promptLicenseDecision.mode
      });
    }
    const selectedPromptSettings =
      signalMode === "local_only"
        ? null
        : requestedPromptTemplateId
          ? (requestedPromptSelection?.runtimeSettings ?? null)
          : await deps.getAiPromptRuntimeSettings(promptScopeContext);
    if (requestedPromptTemplateId && !selectedPromptSettings) {
      return res.status(400).json({ error: "invalid_ai_prompt_template" });
    }
    const promptTimeframeConfig = deps.normalizePromptTimeframeSetForRuntime(
      selectedPromptSettings,
      payload.timeframe
    );
    const effectiveTimeframe =
      selectedStrategyRef?.kind === "ai" || !selectedStrategyRef
        ? promptTimeframeConfig.runTimeframe
        : payload.timeframe;
    const strategyRefForScope: PredictionStrategyRef | null =
      selectedStrategyRef?.kind === "ai"
        ? {
            kind: "ai",
            id: selectedPromptSettings?.activePromptId ?? selectedStrategyRef.id,
            name: selectedPromptSettings?.activePromptName ?? selectedStrategyRef.name
          }
        : selectedStrategyRef;
    const exchangeAccountIdForLimit = deps.readPrefillExchangeAccountId(inputFeatureSnapshot);
    const exchangeForLimit =
      typeof inputFeatureSnapshot.prefillExchange === "string"
        ? deps.normalizeExchangeValue(inputFeatureSnapshot.prefillExchange)
        : null;
    const existingStateIdForLimit =
      exchangeAccountIdForLimit && exchangeForLimit
        ? await deps.findPredictionStateIdByScope({
            userId: user.id,
            exchange: exchangeForLimit,
            accountId: exchangeAccountIdForLimit,
            symbol: normalizedSymbol,
            marketType: payload.marketType,
            timeframe: effectiveTimeframe,
            signalMode,
            strategyRef: strategyRefForScope
          })
        : null;
    const consumesPredictionSlot = deps.isAutoScheduleEnabled(inputFeatureSnapshot.autoScheduleEnabled);
    const predictionCreateAccess = await deps.canCreatePredictionForUser({
      userId: user.id,
      bypass: Boolean(userCtx.hasAdminBackendAccess),
      bucket: predictionLimitBucket,
      existingStateId: existingStateIdForLimit,
      consumesSlot: consumesPredictionSlot
    });
    if (!predictionCreateAccess.allowed) {
      const code = predictionCreateAccess.code ?? "prediction_create_limit_exceeded";
      return res.status(403).json({
        error: code,
        code,
        message: code,
        details: {
          limit: predictionCreateAccess.limit,
          usage: predictionCreateAccess.usage,
          remaining: predictionCreateAccess.remaining,
          runningLimit: predictionCreateAccess.runningLimit,
          runningUsage: predictionCreateAccess.runningUsage,
          runningRemaining: predictionCreateAccess.runningRemaining
        }
      });
    }
    const featureSnapshotWithPrompt = {
      ...inputFeatureSnapshot,
      promptTimeframe: selectedPromptSettings?.runTimeframe ?? selectedPromptSettings?.timeframe ?? null,
      promptTimeframes: promptTimeframeConfig.timeframes,
      promptSlTpSource: selectedPromptSettings?.slTpSource ?? "local",
      promptRunTimeframe:
        selectedStrategyRef?.kind === "ai" || !selectedStrategyRef ? promptTimeframeConfig.runTimeframe : null,
      aiPromptTemplateRequestedId: requestedPromptTemplateId,
      aiPromptTemplateId: selectedPromptSettings?.activePromptId ?? requestedPromptTemplateId,
      aiPromptTemplateName: selectedPromptSettings?.activePromptName ?? null,
      aiPromptMarketAnalysisUpdateEnabled:
        selectedStrategyRef?.kind === "ai" ? Boolean(selectedPromptSettings?.marketAnalysisUpdateEnabled) : false,
      localStrategyId: selectedLocalStrategy?.id ?? null,
      localStrategyName: selectedLocalStrategy?.name ?? null,
      compositeStrategyId: selectedCompositeStrategy?.id ?? null,
      compositeStrategyName: selectedCompositeStrategy?.name ?? null,
      strategyRef: selectedStrategyRef
        ? {
            kind: selectedStrategyRef.kind,
            id: selectedStrategyRef.id,
            name:
              selectedStrategyRef.kind === "ai"
                ? (selectedPromptSettings?.activePromptName ?? selectedStrategyRef.name)
                : selectedStrategyRef.name
          }
        : null,
      aiPromptLicenseMode: promptLicenseDecision.mode,
      aiPromptLicenseWouldBlock: promptLicenseDecision.wouldBlock
    };
    const featureSnapshotWithStrategy = deps.withStrategyRunSnapshot(
      featureSnapshotWithPrompt,
      {
        strategyRef: selectedStrategyRef
          ? {
              kind: selectedStrategyRef.kind,
              id: selectedStrategyRef.id,
              name:
                selectedStrategyRef.kind === "ai"
                  ? (selectedPromptSettings?.activePromptName ?? selectedStrategyRef.name)
                  : selectedStrategyRef.name
            }
          : null,
        status: "skipped",
        signal: payload.prediction.signal,
        expectedMovePct: payload.prediction.expectedMovePct,
        confidence: payload.prediction.confidence,
        source: deps.resolvePreferredSignalSourceForMode(signalMode, deps.PREDICTION_PRIMARY_SIGNAL_SOURCE),
        aiCalled: false,
        explanation: "Manual prediction created; strategy runner applies on refresh cycle.",
        tags: deps.normalizeTagList(inputFeatureSnapshot.tags),
        keyDrivers: [],
        ts: tsCreated
      },
      {
        phase: "manual_generate",
        strategyRef: selectedStrategyRef
      }
    );
    const strategyNewsRiskMode = deps.resolveStrategyNewsRiskMode({
      strategyRef: strategyRefForScope,
      promptSettings: selectedPromptSettings,
      localStrategy: selectedLocalStrategy,
      compositeStrategy: selectedCompositeStrategy
    });
    const globalNewsRiskBlockEnabled = await deps.readGlobalNewsRiskEnforcement();
    const newsRiskBlocked = deps.shouldBlockByNewsRisk({
      featureSnapshot: featureSnapshotWithStrategy,
      globalEnabled: globalNewsRiskBlockEnabled,
      strategyMode: strategyNewsRiskMode
    });
    const featureSnapshotForGenerate = newsRiskBlocked
      ? deps.withStrategyRunSnapshot(
          featureSnapshotWithStrategy,
          {
            strategyRef: strategyRefForScope,
            status: "fallback",
            signal: "neutral",
            expectedMovePct: 0,
            confidence: 0,
            source: deps.resolvePreferredSignalSourceForMode(signalMode, deps.PREDICTION_PRIMARY_SIGNAL_SOURCE),
            aiCalled: false,
            explanation: "News blackout active; setup suspended.",
            tags: ["news_risk"],
            keyDrivers: [
              { name: "featureSnapshot.newsRisk", value: true },
              { name: "policy.reasonCode", value: "news_risk_blocked" }
            ],
            ts: tsCreated
          },
          {
            phase: "manual_generate",
            strategyRef: strategyRefForScope,
            reasonCode: "news_risk_blocked",
            strategyNewsRiskMode
          }
        )
      : featureSnapshotWithStrategy;
    const tracking = deps.derivePredictionTrackingFromSnapshot(featureSnapshotForGenerate, effectiveTimeframe);

    const created = await deps.generateAndPersistPrediction({
      symbol: payload.symbol,
      marketType: payload.marketType,
      timeframe: effectiveTimeframe,
      tsCreated,
      prediction: payload.prediction,
      featureSnapshot: featureSnapshotForGenerate,
      signalMode,
      preferredSignalSource: deps.resolvePreferredSignalSourceForMode(signalMode, deps.PREDICTION_PRIMARY_SIGNAL_SOURCE),
      tracking,
      userId: user.id,
      botId: payload.botId ?? null,
      modelVersionBase: payload.modelVersionBase,
      promptSettings: selectedPromptSettings ?? undefined,
      promptScopeContext,
      newsRiskBlocked: newsRiskBlocked
        ? { reasonCode: "news_risk_blocked", strategyMode: strategyNewsRiskMode }
        : null
    });

    const snapshot = deps.asRecord(created.featureSnapshot);
    const notificationTags = deps.enforceNewsRiskTag(
      created.explanation.tags.length > 0 ? created.explanation.tags : created.featureSnapshot.tags,
      created.featureSnapshot
    );
    const exchangeAccountId = deps.readPrefillExchangeAccountId(snapshot);
    if (exchangeAccountId) {
      const exchange =
        typeof snapshot.prefillExchange === "string" && snapshot.prefillExchange.trim()
          ? deps.normalizeExchangeValue(snapshot.prefillExchange)
          : "bitget";
      const keyDrivers = deps.normalizeKeyDriverList(created.explanation.keyDrivers);
      const tsDate = new Date(tsCreated);
      const changeHash = deps.buildPredictionChangeHash({
        signal: created.prediction.signal,
        confidence: created.prediction.confidence,
        tags: notificationTags,
        keyDrivers,
        featureSnapshot: created.featureSnapshot
      });
      const existingStateId = await deps.findPredictionStateIdByScope({
        userId: user.id,
        exchange,
        accountId: exchangeAccountId,
        symbol: normalizedSymbol,
        marketType: payload.marketType,
        timeframe: effectiveTimeframe,
        signalMode,
        strategyRef: deps.readPredictionStrategyRef(snapshot)
      });
      const statePayload = {
        ...deps.toPredictionStateStrategyScope(deps.readPredictionStrategyRef(created.featureSnapshot)),
        exchange,
        accountId: exchangeAccountId,
        userId: user.id,
        symbol: normalizedSymbol,
        marketType: payload.marketType,
        timeframe: effectiveTimeframe,
        signalMode,
        tsUpdated: tsDate,
        tsPredictedFor: new Date(tsDate.getTime() + deps.timeframeToIntervalMs(effectiveTimeframe)),
        signal: created.prediction.signal,
        expectedMovePct: Number.isFinite(Number(created.prediction.expectedMovePct))
          ? Number(created.prediction.expectedMovePct)
          : null,
        confidence: Number.isFinite(Number(created.prediction.confidence))
          ? Number(created.prediction.confidence)
          : 0,
        tags: notificationTags,
        explanation: created.explanation.explanation,
        keyDrivers,
        featuresSnapshot: created.featureSnapshot,
        modelVersion: created.modelVersion,
        lastAiExplainedAt: signalMode === "local_only" ? null : tsDate,
        lastChangeHash: changeHash,
        lastChangeReason: "manual",
        autoScheduleEnabled: deps.isAutoScheduleEnabled(snapshot.autoScheduleEnabled),
        autoSchedulePaused: deps.isAutoSchedulePaused(snapshot),
        directionPreference: deps.parseDirectionPreference(snapshot.directionPreference),
        confidenceTargetPct: deps.readConfidenceTarget(snapshot),
        leverage: deps.readRequestedLeverage(snapshot)
      };
      const stateRow = await deps.persistPredictionState({
        existingStateId,
        stateData: statePayload,
        scope: {
          userId: user.id,
          exchange,
          accountId: exchangeAccountId,
          symbol: normalizedSymbol,
          marketType: payload.marketType,
          timeframe: effectiveTimeframe,
          signalMode
        }
      });

      await deps.db.predictionEvent.create({
        data: {
          stateId: stateRow.id,
          changeType: "manual",
          prevSnapshot: null,
          newSnapshot: {
            signal: created.prediction.signal,
            confidence: created.prediction.confidence,
            expectedMovePct: created.prediction.expectedMovePct,
            tags: notificationTags
          },
          delta: { reason: "manual_generate" },
          horizonEvalRef: created.rowId,
          modelVersion: created.modelVersion,
          reason: "manual_generate"
        }
      });
    }

    await deps.dispatchTradablePredictionNotification({
      userId: user.id,
      exchange:
        typeof snapshot.prefillExchange === "string" && snapshot.prefillExchange.trim()
          ? snapshot.prefillExchange.trim().toLowerCase()
          : "bitget",
      exchangeAccountLabel:
        typeof snapshot.prefillExchangeAccountId === "string" && snapshot.prefillExchangeAccountId.trim()
          ? snapshot.prefillExchangeAccountId.trim()
          : "n/a",
      symbol: payload.symbol,
      marketType: payload.marketType,
      timeframe: effectiveTimeframe,
      signal: created.prediction.signal,
      confidence: created.prediction.confidence,
      confidenceTargetPct: deps.readConfidenceTarget(snapshot),
      expectedMovePct: created.prediction.expectedMovePct,
      predictionId: created.rowId,
      explanation: created.explanation.explanation,
      source: "manual",
      signalSource: created.signalSource,
      tags: notificationTags,
      aiPromptTemplateName: deps.resolveNotificationStrategyName({
        signalSource: created.signalSource,
        snapshot,
        strategyRef: deps.readPredictionStrategyRef(snapshot)
      })
    });
    if (deps.readAiPromptMarketAnalysisUpdateEnabled(snapshot)) {
      await deps.dispatchMarketAnalysisUpdateNotification({
        userId: user.id,
        exchange:
          typeof snapshot.prefillExchange === "string" && snapshot.prefillExchange.trim()
            ? snapshot.prefillExchange.trim().toLowerCase()
            : "bitget",
        exchangeAccountLabel:
          typeof snapshot.prefillExchangeAccountId === "string" && snapshot.prefillExchangeAccountId.trim()
            ? snapshot.prefillExchangeAccountId.trim()
            : "n/a",
        symbol: payload.symbol,
        marketType: payload.marketType,
        timeframe: effectiveTimeframe,
        signal: created.prediction.signal,
        confidence: created.prediction.confidence,
        expectedMovePct: created.prediction.expectedMovePct,
        predictionId: created.rowId,
        explanation: created.explanation.explanation,
        source: "manual",
        signalSource: created.signalSource,
        tags: notificationTags,
        aiPromptTemplateName: deps.resolveNotificationStrategyName({
          signalSource: created.signalSource,
          snapshot,
          strategyRef: deps.readPredictionStrategyRef(snapshot)
        })
      });
    }

    return res.status(created.persisted ? 201 : 202).json({
      persisted: created.persisted,
      prediction: {
        symbol: payload.symbol,
        marketType: payload.marketType,
        timeframe: effectiveTimeframe,
        tsCreated,
        ...created.prediction
      },
      signalMode,
      signalSource: created.signalSource,
      explanation: created.explanation,
      modelVersion: created.modelVersion,
      predictionId: created.rowId,
      aiPromptTemplateId: deps.readAiPromptTemplateId(snapshot),
      aiPromptTemplateName: deps.readAiPromptTemplateName(snapshot),
      localStrategyId: deps.readLocalStrategyId(snapshot),
      localStrategyName: deps.readLocalStrategyName(snapshot),
      compositeStrategyId: deps.readCompositeStrategyId(snapshot),
      compositeStrategyName: deps.readCompositeStrategyName(snapshot),
      strategyRef: deps.readPredictionStrategyRef(snapshot)
    });
  });

  app.post("/api/predictions/generate-auto", requireAuth, async (req, res) => {
    const user = getUserFromLocals(res);
    const parsed = predictionGenerateAutoSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "invalid_payload", details: parsed.error.flatten() });
    }

    const payload = parsed.data;
    const userCtx = await deps.resolveUserContext(user);

    try {
      const created = await deps.generateAutoPredictionForUser(user.id, payload, {
        isSuperadmin: deps.isSuperadminEmail(user.email),
        hasAdminBackendAccess: userCtx.hasAdminBackendAccess,
        userEmail: user.email
      });
      return res.status(created.persisted ? 201 : 202).json({
        persisted: created.persisted,
        existing: created.existing ?? false,
        existingStateId: created.existingStateId ?? null,
        prediction: {
          symbol: deps.normalizeSymbolInput(payload.symbol),
          marketType: payload.marketType,
          timeframe: created.timeframe,
          tsCreated: created.tsCreated,
          ...created.prediction
        },
        directionPreference: created.directionPreference,
        confidenceTargetPct: created.confidenceTargetPct,
        leverage: payload.leverage ?? null,
        signalMode: created.signalMode,
        signalSource: created.signalSource,
        explanation: created.explanation,
        modelVersion: created.modelVersion,
        predictionId: created.predictionId,
        aiPromptTemplateId: created.aiPromptTemplateId,
        aiPromptTemplateName: created.aiPromptTemplateName,
        localStrategyId: created.localStrategyId,
        localStrategyName: created.localStrategyName,
        compositeStrategyId: created.compositeStrategyId,
        compositeStrategyName: created.compositeStrategyName,
        strategyRef: created.strategyRef
      });
    } catch (error) {
      return deps.sendManualTradingError(res, error);
    }
  });
}
