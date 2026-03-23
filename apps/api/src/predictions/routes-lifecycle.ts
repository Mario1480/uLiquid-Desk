import express from "express";
import { z } from "zod";
import { getUserFromLocals, requireAuth } from "../auth.js";

const predictionPauseSchema = z.object({
  paused: z.coerce.boolean().default(true)
});

const predictionIdParamSchema = z.object({
  id: z.string().trim().min(1)
});

export type RegisterPredictionLifecycleRoutesDeps = {
  db: any;
  getAccessSectionSettings(): Promise<any>;
  evaluateAccessSectionBypassForUser(user: any): Promise<boolean>;
  readPredictionStrategyRef(snapshot: Record<string, any>): any;
  readStateSignalMode(
    stateSignalMode: unknown,
    snapshot: Record<string, any>
  ): "local_only" | "ai_only" | "both";
  resolvePredictionLimitBucketFromStrategy(input: {
    strategyRef?: any;
    signalMode?: "local_only" | "ai_only" | "both";
  }): string;
  predictionQuotaKindFromBucket(bucket: string): "local" | "ai" | "composite";
  canEnablePredictionSchedule(input: {
    userId: string;
    kind: "local" | "ai" | "composite";
    currentlyEnabled: boolean;
    currentlyPaused: boolean;
    caps: any;
  }): Promise<any>;
  asRecord(value: unknown): Record<string, any>;
  findPredictionTemplateRowIds(userId: string, input: {
    symbol: string;
    marketType: "spot" | "perp";
    timeframe: "5m" | "15m" | "1h" | "4h" | "1d";
    exchangeAccountId: string | null;
    signalMode?: "local_only" | "ai_only" | "both" | null;
    strategyRef?: any;
  }): Promise<string[]>;
  normalizeSymbolInput(value: string | null | undefined): string | null;
  normalizePredictionMarketType(value: unknown): "spot" | "perp";
  normalizePredictionTimeframe(value: unknown): "5m" | "15m" | "1h" | "4h" | "1d";
  sendPredictionScheduleError(res: express.Response, error: unknown, operation: string): express.Response;
  resolvePredictionTemplateScope(userId: string, predictionId: string): Promise<any>;
  withAutoScheduleFlag(featuresSnapshot: unknown, enabled: boolean): Record<string, any>;
  predictionTriggerDebounceState: Map<string, unknown>;
};

export function registerPredictionLifecycleRoutes(
  app: express.Express,
  deps: RegisterPredictionLifecycleRoutesDeps
) {
  app.post("/api/predictions/:id/pause", requireAuth, async (req, res) => {
    try {
      const user = getUserFromLocals(res);
      const bypass = await deps.evaluateAccessSectionBypassForUser(user);
      const params = predictionIdParamSchema.safeParse(req.params);
      if (!params.success) {
        return res.status(400).json({ error: "invalid_prediction_id" });
      }
      const body = predictionPauseSchema.safeParse(req.body ?? {});
      if (!body.success) {
        return res.status(400).json({ error: "invalid_payload", details: body.error.flatten() });
      }

      const stateRow = await deps.db.predictionState.findFirst({
        where: {
          id: params.data.id,
          userId: user.id
        },
        select: {
          id: true,
          autoScheduleEnabled: true,
          autoSchedulePaused: true,
          signalMode: true,
          featuresSnapshot: true,
          symbol: true,
          marketType: true,
          timeframe: true,
          accountId: true
        }
      });

      if (stateRow) {
        const snapshot = deps.asRecord(stateRow.featuresSnapshot);
        const signalMode = deps.readStateSignalMode(stateRow.signalMode, snapshot);
        if (!body.data.paused && !bypass) {
          const limitBucket = deps.resolvePredictionLimitBucketFromStrategy({
            strategyRef: deps.readPredictionStrategyRef(snapshot),
            signalMode
          });
          const scheduleCheck = await deps.canEnablePredictionSchedule({
            userId: user.id,
            kind: deps.predictionQuotaKindFromBucket(limitBucket),
            currentlyEnabled: Boolean(stateRow.autoScheduleEnabled),
            currentlyPaused: Boolean(stateRow.autoSchedulePaused),
            caps: null
          });
          if (!scheduleCheck.allowed) {
            return res.status(403).json({
              error: scheduleCheck.reason,
              code: scheduleCheck.reason,
              message: scheduleCheck.reason,
              details: {
                limits: scheduleCheck.limits.predictions,
                usage: scheduleCheck.usage.predictions
              }
            });
          }
        }
        await deps.db.predictionState.update({
          where: { id: stateRow.id },
          data: {
            autoScheduleEnabled: true,
            autoSchedulePaused: body.data.paused,
            featuresSnapshot: {
              ...snapshot,
              autoScheduleEnabled: true,
              autoSchedulePaused: body.data.paused
            }
          }
        });

        const normalizedSymbol = deps.normalizeSymbolInput(stateRow.symbol);
        const templateRowIds = await deps.findPredictionTemplateRowIds(user.id, {
          symbol: normalizedSymbol || stateRow.symbol,
          marketType: deps.normalizePredictionMarketType(stateRow.marketType),
          timeframe: deps.normalizePredictionTimeframe(stateRow.timeframe),
          exchangeAccountId: typeof stateRow.accountId === "string" ? stateRow.accountId : null,
          signalMode,
          strategyRef: deps.readPredictionStrategyRef(snapshot)
        });

        if (templateRowIds.length > 0) {
          const rows = await deps.db.prediction.findMany({
            where: {
              id: { in: templateRowIds },
              userId: user.id
            },
            select: {
              id: true,
              featuresSnapshot: true
            }
          });

          for (const row of rows as any[]) {
            const rowSnapshot = deps.asRecord(row.featuresSnapshot);
            await deps.db.prediction.update({
              where: { id: row.id },
              data: {
                featuresSnapshot: {
                  ...rowSnapshot,
                  autoScheduleEnabled: true,
                  autoSchedulePaused: body.data.paused
                }
              }
            });
          }
        }

        return res.json({
          ok: true,
          paused: body.data.paused,
          updatedCount: 1
        });
      }

      const scope = await deps.resolvePredictionTemplateScope(user.id, params.data.id);
      if (!scope) {
        return res.status(404).json({ error: "prediction_not_found" });
      }

      const templateRowIds = await deps.findPredictionTemplateRowIds(user.id, {
        symbol: scope.symbol,
        marketType: scope.marketType,
        timeframe: scope.timeframe,
        exchangeAccountId: scope.exchangeAccountId,
        signalMode: scope.signalMode,
        strategyRef: scope.strategyRef
      });
      const ids = templateRowIds.length > 0 ? templateRowIds : [scope.rowId];

      const rows = await deps.db.prediction.findMany({
        where: {
          id: { in: ids },
          userId: user.id
        },
        select: {
          id: true,
          featuresSnapshot: true
        }
      });

      if (!body.data.paused && !bypass) {
        const scheduleCheck = await deps.canEnablePredictionSchedule({
          userId: user.id,
          kind: deps.predictionQuotaKindFromBucket(
            deps.resolvePredictionLimitBucketFromStrategy({
              strategyRef: scope.strategyRef,
              signalMode: scope.signalMode
            })
          ),
          currentlyEnabled: false,
          currentlyPaused: false,
          caps: null
        });
        if (!scheduleCheck.allowed) {
          return res.status(403).json({
            error: scheduleCheck.reason,
            code: scheduleCheck.reason,
            message: scheduleCheck.reason,
            details: {
              limits: scheduleCheck.limits.predictions,
              usage: scheduleCheck.usage.predictions
            }
          });
        }
      }

      for (const row of rows as any[]) {
        const snapshot = deps.asRecord(row.featuresSnapshot);
        await deps.db.prediction.update({
          where: { id: row.id },
          data: {
            featuresSnapshot: {
              ...snapshot,
              autoScheduleEnabled: true,
              autoSchedulePaused: body.data.paused
            }
          }
        });
      }

      return res.json({
        ok: true,
        paused: body.data.paused,
        updatedCount: rows.length
      });
    } catch (error) {
      return deps.sendPredictionScheduleError(res, error, "pause");
    }
  });

  app.post("/api/predictions/:id/stop", requireAuth, async (req, res) => {
    try {
      const user = getUserFromLocals(res);
      const params = predictionIdParamSchema.safeParse(req.params);
      if (!params.success) {
        return res.status(400).json({ error: "invalid_prediction_id" });
      }

      const stateRow = await deps.db.predictionState.findFirst({
        where: {
          id: params.data.id,
          userId: user.id
        },
        select: {
          id: true,
          signalMode: true,
          featuresSnapshot: true,
          symbol: true,
          marketType: true,
          timeframe: true,
          accountId: true
        }
      });

      if (stateRow) {
        const snapshot = deps.asRecord(stateRow.featuresSnapshot);
        const signalMode = deps.readStateSignalMode(stateRow.signalMode, snapshot);
        await deps.db.predictionState.update({
          where: { id: stateRow.id },
          data: {
            autoScheduleEnabled: false,
            autoSchedulePaused: false,
            featuresSnapshot: {
              ...snapshot,
              autoScheduleEnabled: false,
              autoSchedulePaused: false
            }
          }
        });

        const normalizedSymbol = deps.normalizeSymbolInput(stateRow.symbol);
        const templateRowIds = await deps.findPredictionTemplateRowIds(user.id, {
          symbol: normalizedSymbol || stateRow.symbol,
          marketType: deps.normalizePredictionMarketType(stateRow.marketType),
          timeframe: deps.normalizePredictionTimeframe(stateRow.timeframe),
          exchangeAccountId: typeof stateRow.accountId === "string" ? stateRow.accountId : null,
          signalMode,
          strategyRef: deps.readPredictionStrategyRef(snapshot)
        });

        if (templateRowIds.length > 0) {
          const rows = await deps.db.prediction.findMany({
            where: {
              id: { in: templateRowIds },
              userId: user.id
            },
            select: {
              id: true,
              featuresSnapshot: true
            }
          });

          for (const row of rows as any[]) {
            await deps.db.prediction.update({
              where: { id: row.id },
              data: {
                featuresSnapshot: deps.withAutoScheduleFlag(row.featuresSnapshot, false)
              }
            });
          }
        }

        return res.json({
          ok: true,
          stoppedCount: 1
        });
      }

      const scope = await deps.resolvePredictionTemplateScope(user.id, params.data.id);
      if (!scope) {
        return res.status(404).json({ error: "prediction_not_found" });
      }

      const templateRowIds = await deps.findPredictionTemplateRowIds(user.id, {
        symbol: scope.symbol,
        marketType: scope.marketType,
        timeframe: scope.timeframe,
        exchangeAccountId: scope.exchangeAccountId,
        signalMode: scope.signalMode,
        strategyRef: scope.strategyRef
      });
      const ids = templateRowIds.length > 0 ? templateRowIds : [scope.rowId];

      const rows = await deps.db.prediction.findMany({
        where: {
          id: { in: ids },
          userId: user.id
        },
        select: {
          id: true,
          featuresSnapshot: true
        }
      });

      for (const row of rows as any[]) {
        await deps.db.prediction.update({
          where: { id: row.id },
          data: {
            featuresSnapshot: deps.withAutoScheduleFlag(row.featuresSnapshot, false)
          }
        });
      }

      return res.json({
        ok: true,
        stoppedCount: rows.length
      });
    } catch (error) {
      return deps.sendPredictionScheduleError(res, error, "stop");
    }
  });

  app.post("/api/predictions/:id/delete-schedule", requireAuth, async (req, res) => {
    try {
      const user = getUserFromLocals(res);
      const params = predictionIdParamSchema.safeParse(req.params);
      if (!params.success) {
        return res.status(400).json({ error: "invalid_prediction_id" });
      }

      const stateRow = await deps.db.predictionState.findFirst({
        where: {
          id: params.data.id,
          userId: user.id
        },
        select: {
          id: true,
          signalMode: true,
          featuresSnapshot: true,
          symbol: true,
          marketType: true,
          timeframe: true,
          accountId: true
        }
      });

      if (stateRow) {
        await deps.db.predictionState.delete({
          where: { id: stateRow.id }
        });
        deps.predictionTriggerDebounceState.delete(stateRow.id);
        const normalizedSymbol = deps.normalizeSymbolInput(stateRow.symbol);
        const stateSnapshot = deps.asRecord(stateRow.featuresSnapshot);
        const stateSignalMode = deps.readStateSignalMode(stateRow.signalMode, stateSnapshot);

        const templateRowIds = await deps.findPredictionTemplateRowIds(user.id, {
          symbol: normalizedSymbol || stateRow.symbol,
          marketType: deps.normalizePredictionMarketType(stateRow.marketType),
          timeframe: deps.normalizePredictionTimeframe(stateRow.timeframe),
          exchangeAccountId: typeof stateRow.accountId === "string" ? stateRow.accountId : null,
          signalMode: stateSignalMode,
          strategyRef: deps.readPredictionStrategyRef(stateSnapshot)
        });

        const deletedTemplates =
          templateRowIds.length > 0
            ? await deps.db.prediction.deleteMany({
                where: {
                  userId: user.id,
                  id: { in: templateRowIds }
                }
              })
            : { count: 0 };

        return res.json({
          ok: true,
          deletedCount: 1 + deletedTemplates.count
        });
      }

      const scope = await deps.resolvePredictionTemplateScope(user.id, params.data.id);
      if (!scope) {
        return res.status(404).json({ error: "prediction_not_found" });
      }

      const templateRowIds = await deps.findPredictionTemplateRowIds(user.id, {
        symbol: scope.symbol,
        marketType: scope.marketType,
        timeframe: scope.timeframe,
        exchangeAccountId: scope.exchangeAccountId,
        signalMode: scope.signalMode,
        strategyRef: scope.strategyRef
      });
      const ids = templateRowIds.length > 0 ? templateRowIds : [scope.rowId];

      const deleted = await deps.db.prediction.deleteMany({
        where: {
          userId: user.id,
          id: { in: ids }
        }
      });

      return res.json({
        ok: true,
        deletedCount: deleted.count
      });
    } catch (error) {
      return deps.sendPredictionScheduleError(res, error, "delete-schedule");
    }
  });
}
