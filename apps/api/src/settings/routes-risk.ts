import express from "express";
import { z } from "zod";
import { getUserFromLocals, requireAuth } from "../auth.js";

const settingsRiskAccountParamSchema = z.object({
  exchangeAccountId: z.string().trim().min(1)
});

const settingsRiskUpdateSchema = z.object({
  dailyLossWarnPct: z.coerce.number().finite().min(0).optional(),
  dailyLossWarnUsd: z.coerce.number().finite().min(0).optional(),
  dailyLossCriticalPct: z.coerce.number().finite().min(0).optional(),
  dailyLossCriticalUsd: z.coerce.number().finite().min(0).optional(),
  marginWarnPct: z.coerce.number().finite().min(0).optional(),
  marginWarnUsd: z.coerce.number().finite().min(0).optional(),
  marginCriticalPct: z.coerce.number().finite().min(0).optional(),
  marginCriticalUsd: z.coerce.number().finite().min(0).optional()
}).refine(
  (value) => Object.values(value).some((entry) => entry !== undefined),
  { message: "Provide at least one field to update." }
);

export type RegisterSettingsRiskRoutesDeps = {
  db: any;
  DEFAULT_EXCHANGE_ACCOUNT_RISK_LIMITS: any;
  readBotRealizedPnlTodayByAccount(userId: string, exchangeAccountIds: string[]): Promise<Map<string, any>>;
  resolveEffectivePnlTodayUsd(rawPnlTodayUsd: unknown, botRealizedToday: any): number;
  toSettingsRiskItem(account: any, limits: any): any;
  mergeRiskProfileWithDefaults(profile: any): any;
  validateRiskLimitValues(limits: any): string[];
};

export function registerSettingsRiskRoutes(
  app: express.Express,
  deps: RegisterSettingsRiskRoutesDeps
) {
  app.get("/settings/risk", requireAuth, async (_req, res) => {
    const user = getUserFromLocals(res);
    const accounts = await deps.db.exchangeAccount.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        exchange: true,
        label: true,
        lastUsedAt: true,
        futuresBudgetEquity: true,
        futuresBudgetAvailableMargin: true,
        pnlTodayUsd: true,
        riskProfile: {
          select: {
            dailyLossWarnPct: true,
            dailyLossWarnUsd: true,
            dailyLossCriticalPct: true,
            dailyLossCriticalUsd: true,
            marginWarnPct: true,
            marginWarnUsd: true,
            marginCriticalPct: true,
            marginCriticalUsd: true
          }
        }
      }
    });
    const accountIds = accounts
      .map((row: any) => (typeof row.id === "string" ? String(row.id) : ""))
      .filter(Boolean);
    const botRealizedByAccount = await deps.readBotRealizedPnlTodayByAccount(user.id, accountIds);

    return res.json({
      defaults: deps.DEFAULT_EXCHANGE_ACCOUNT_RISK_LIMITS,
      items: accounts.map((account: any) => {
        const botRealizedToday = botRealizedByAccount.get(String(account.id)) ?? null;
        const effectivePnlTodayUsd = deps.resolveEffectivePnlTodayUsd(account.pnlTodayUsd, botRealizedToday);
        return deps.toSettingsRiskItem(
          {
            ...account,
            pnlTodayUsd: effectivePnlTodayUsd
          },
          deps.mergeRiskProfileWithDefaults(account.riskProfile)
        );
      })
    });
  });

  app.put("/settings/risk/:exchangeAccountId", requireAuth, async (req, res) => {
    const user = getUserFromLocals(res);
    const params = settingsRiskAccountParamSchema.safeParse(req.params ?? {});
    if (!params.success) {
      return res.status(400).json({ error: "invalid_params", details: params.error.flatten() });
    }
    const parsed = settingsRiskUpdateSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return res.status(400).json({ error: "invalid_payload", details: parsed.error.flatten() });
    }

    const account = await deps.db.exchangeAccount.findFirst({
      where: {
        id: params.data.exchangeAccountId,
        userId: user.id
      },
      select: {
        id: true,
        exchange: true,
        label: true,
        lastUsedAt: true,
        futuresBudgetEquity: true,
        futuresBudgetAvailableMargin: true,
        pnlTodayUsd: true,
        riskProfile: {
          select: {
            dailyLossWarnPct: true,
            dailyLossWarnUsd: true,
            dailyLossCriticalPct: true,
            dailyLossCriticalUsd: true,
            marginWarnPct: true,
            marginWarnUsd: true,
            marginCriticalPct: true,
            marginCriticalUsd: true
          }
        }
      }
    });
    if (!account) {
      return res.status(404).json({ error: "exchange_account_not_found" });
    }

    const current = deps.mergeRiskProfileWithDefaults(account.riskProfile);
    const next = {
      dailyLossWarnPct: parsed.data.dailyLossWarnPct ?? current.dailyLossWarnPct,
      dailyLossWarnUsd: parsed.data.dailyLossWarnUsd ?? current.dailyLossWarnUsd,
      dailyLossCriticalPct: parsed.data.dailyLossCriticalPct ?? current.dailyLossCriticalPct,
      dailyLossCriticalUsd: parsed.data.dailyLossCriticalUsd ?? current.dailyLossCriticalUsd,
      marginWarnPct: parsed.data.marginWarnPct ?? current.marginWarnPct,
      marginWarnUsd: parsed.data.marginWarnUsd ?? current.marginWarnUsd,
      marginCriticalPct: parsed.data.marginCriticalPct ?? current.marginCriticalPct,
      marginCriticalUsd: parsed.data.marginCriticalUsd ?? current.marginCriticalUsd
    };

    const issues = deps.validateRiskLimitValues(next);
    if (issues.length > 0) {
      return res.status(400).json({
        error: "invalid_payload",
        details: { issues }
      });
    }

    await deps.db.exchangeAccountRiskProfile.upsert({
      where: {
        exchangeAccountId: account.id
      },
      create: {
        exchangeAccountId: account.id,
        dailyLossWarnPct: next.dailyLossWarnPct,
        dailyLossWarnUsd: next.dailyLossWarnUsd,
        dailyLossCriticalPct: next.dailyLossCriticalPct,
        dailyLossCriticalUsd: next.dailyLossCriticalUsd,
        marginWarnPct: next.marginWarnPct,
        marginWarnUsd: next.marginWarnUsd,
        marginCriticalPct: next.marginCriticalPct,
        marginCriticalUsd: next.marginCriticalUsd
      },
      update: {
        dailyLossWarnPct: next.dailyLossWarnPct,
        dailyLossWarnUsd: next.dailyLossWarnUsd,
        dailyLossCriticalPct: next.dailyLossCriticalPct,
        dailyLossCriticalUsd: next.dailyLossCriticalUsd,
        marginWarnPct: next.marginWarnPct,
        marginWarnUsd: next.marginWarnUsd,
        marginCriticalPct: next.marginCriticalPct,
        marginCriticalUsd: next.marginCriticalUsd
      }
    });

    const botRealizedByAccount = await deps.readBotRealizedPnlTodayByAccount(user.id, [account.id]);
    const botRealizedToday = botRealizedByAccount.get(account.id) ?? null;
    const effectivePnlTodayUsd = deps.resolveEffectivePnlTodayUsd(account.pnlTodayUsd, botRealizedToday);

    return res.json({
      item: deps.toSettingsRiskItem(
        {
          ...account,
          pnlTodayUsd: effectivePnlTodayUsd
        },
        next
      )
    });
  });
}
