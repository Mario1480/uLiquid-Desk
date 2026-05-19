import crypto from "node:crypto";
import express from "express";
import { z } from "zod";
import { getUserFromLocals, requireAuth } from "../auth.js";
import { SESSION_COOKIE } from "../auth/cookies.js";
import { LEGAL_ACKNOWLEDGEMENT_VERSION } from "../legalAcknowledgement.js";
import {
  findTelegramChatIdConflict as findTelegramChatIdConflictFromDeps,
  isPrismaUniqueConstraintError,
  normalizeTelegramChatId,
  TELEGRAM_CHAT_ID_IN_USE_ERROR
} from "../telegram/chatIdUniqueness.js";
import {
  createTelegramLinkSession,
  getTelegramLinkStatus,
  invalidateOpenTelegramLinkSessions,
  resolveTelegramBotUsername,
  resolveTelegramLinkTtlMinutes
} from "../telegram/linking.js";
import { resolveTelegramConfig, sendTelegramMessage } from "../telegram/notifications.js";
import { isApnsConfigured as defaultIsApnsConfigured } from "../plugins/notifications/apnsNotificationPlugin.js";

const alertsSettingsSchema = z.object({
  telegramBotToken: z.string().trim().nullable().optional(),
  telegramChatId: z.string().trim().nullable().optional(),
  notificationPlugins: z.object({
    enabled: z.array(z.string().trim().min(1).max(160)).max(100).optional(),
    disabled: z.array(z.string().trim().min(1).max(160)).max(100).optional(),
    order: z.array(z.string().trim().min(1).max(160)).max(100).optional()
  }).optional(),
  notificationDestinations: z.object({
    webhook: z.object({
      url: z.string().trim().url().nullable().optional(),
      headers: z.record(z.string().trim().min(1).max(500)).optional()
    }).optional()
  }).optional(),
  dailyEconomicCalendar: z.object({
    enabled: z.boolean().optional(),
    currencies: z.array(z.string().trim().min(2).max(10)).max(16).optional(),
    impacts: z.array(z.enum(["low", "medium", "high"])).min(1).max(3).optional(),
    sendTimeLocal: z.string().trim().regex(/^([01]\d|2[0-3]):([0-5]\d)$/).optional(),
    timezoneMode: z.enum(["device", "manual"]).optional(),
    timezone: z.string().trim().min(1).max(128).refine((value) => {
      try {
        new Intl.DateTimeFormat("en-US", { timeZone: value }).format(new Date());
        return true;
      } catch {
        return false;
      }
    }, "invalid_timezone").optional()
  }).optional()
});

const securitySettingsSchema = z.object({
  autoLogoutEnabled: z.boolean().optional(),
  autoLogoutMinutes: z.number().int().min(1).max(1440).optional(),
  reauthOtpEnabled: z.boolean().optional()
});

const accountDeletionSchema = z.object({
  confirmEmail: z.string().trim().email().max(320),
  confirmText: z.string().trim().max(64)
});

const accessSectionVisibilitySchema = z.object({
  tradingDesk: z.boolean().default(true),
  bots: z.boolean().default(true),
  gridBots: z.boolean().default(true),
  predictionsDashboard: z.boolean().default(true),
  economicCalendar: z.boolean().default(true),
  news: z.boolean().default(true),
  strategy: z.boolean().default(true)
});

const accessSectionMaintenanceSchema = z.object({
  enabled: z.boolean().default(false)
});

const adminAccessSectionSettingsSchema = z.object({
  visibility: accessSectionVisibilitySchema.default({}),
  maintenance: accessSectionMaintenanceSchema.default({})
});

const adminServerInfoSchema = z.object({
  serverIpAddress: z.string().trim().max(255).nullable().optional()
});

function parseTelegramConfigValue(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function buildTelegramChatIdConflictResponse(res: express.Response): express.Response {
  return res.status(409).json(TELEGRAM_CHAT_ID_IN_USE_ERROR);
}

function hashSessionToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function isoOrNull(value: unknown): string | null {
  return value instanceof Date && Number.isFinite(value.getTime()) ? value.toISOString() : null;
}

function normalizePushEnvironment(value: unknown): "sandbox" | "production" {
  return String(value ?? process.env.APNS_ENV ?? "").trim().toLowerCase() === "sandbox"
    ? "sandbox"
    : "production";
}

function toMobilePushTokenDto(row: any) {
  return {
    id: String(row.id),
    platform: String(row.platform ?? "ios"),
    environment: String(row.environment ?? "production"),
    bundleId: String(row.bundleId ?? ""),
    deviceId: row.deviceId ?? null,
    appVersion: row.appVersion ?? null,
    enabled: Boolean(row.enabled),
    lastSeenAt: isoOrNull(row.lastSeenAt),
    revokedAt: isoOrNull(row.revokedAt),
    createdAt: isoOrNull(row.createdAt)
  };
}

function normalizeEmail(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function accountDeletionGlobalSettingFilters(userId: string) {
  return [
    { key: `trade_settings:${userId}` },
    { key: { startsWith: `settings.alerts.dailyEconomicCalendar.v1:${userId}` } },
    { key: { startsWith: `settings.notifications.plugins.v1:${userId}` } },
    { key: { startsWith: `settings.notifications.destinations.v1:${userId}` } }
  ];
}

export type RegisterSettingsCoreRoutesDeps = {
  db: any;
  isSuperadminEmail(email: string): boolean;
  resolveUserContext(user: { id: string; email: string }): Promise<{ isSuperadmin: boolean }>;
  getSecurityGlobalSettings(): Promise<{ reauthOtpEnabled: boolean }>;
  setSecurityGlobalSettings(next: { reauthOtpEnabled: boolean }): Promise<void>;
  getSecurityUserReauthOverride(userId: string): Promise<boolean | null>;
  setSecurityUserReauthOverride(userId: string, enabled: boolean): Promise<void>;
  getAllowedExchangeValues(): Promise<string[]>;
  getExchangeOptionsResponse(allowed: string[]): unknown;
  getServerInfoSettings(): Promise<{ serverIpAddress: string | null }>;
  getDailyEconomicCalendarSettingsForUser(userId: string): Promise<any>;
  updateDailyEconomicCalendarSettingsForUser(params: {
    userId: string;
    patch: Record<string, unknown>;
  }): Promise<any>;
  getNotificationPluginSettingsForUser(userId: string): Promise<any>;
  updateNotificationPluginSettingsForUser(params: {
    userId: string;
    patch: Record<string, unknown>;
  }): Promise<any>;
  getNotificationDestinationsSettingsForUser(userId: string): Promise<any>;
  updateNotificationDestinationsSettingsForUser(params: {
    userId: string;
    patch: Record<string, unknown>;
  }): Promise<any>;
  toNotificationDestinationsSettingsResponse(settings: any): any;
  toDailyEconomicCalendarSettingsResponse(settings: any): any;
  requireSuperadmin(res: express.Response): Promise<boolean>;
  GLOBAL_SETTING_ACCESS_SECTION_KEY: string;
  GLOBAL_SETTING_SERVER_INFO_KEY: string;
  parseStoredAccessSectionSettings(value: unknown): any;
  toEffectiveAccessSectionSettings(value: unknown): any;
  DEFAULT_ACCESS_SECTION_SETTINGS: any;
  setGlobalSettingValue(key: string, value: unknown): Promise<{ value: unknown; updatedAt: Date | null }>;
  normalizeServerIpAddress(value: unknown): string | null;
  getAccessSectionSettings(): Promise<any>;
  getAccessSectionUsageForUser(userId: string): Promise<any>;
  evaluateAccessSectionBypassForUser(user: { id: string; email: string }): Promise<boolean>;
  computeRemaining(limit: number | null, usage: number): number | null;
  resolveTelegramConfig?: typeof resolveTelegramConfig;
  sendTelegramMessage?: typeof sendTelegramMessage;
  isApnsConfigured?: typeof defaultIsApnsConfigured;
};

export function registerSettingsCoreRoutes(
  app: express.Express,
  deps: RegisterSettingsCoreRoutesDeps
) {
  const resolveTelegramConfigFn = deps.resolveTelegramConfig ?? resolveTelegramConfig;
  const sendTelegramMessageFn = deps.sendTelegramMessage ?? sendTelegramMessage;
  const isApnsConfiguredFn = deps.isApnsConfigured ?? defaultIsApnsConfigured;
  const buildAlertsResponse = async (params: {
    userId: string;
    isSuperadmin: boolean;
  }) => {
    const [config, userSettings, dailyEconomicCalendar, notificationPlugins, notificationDestinations, telegramLink] = await Promise.all([
      deps.db.alertConfig.findUnique({
        where: { key: "default" },
        select: {
          telegramBotToken: true
        }
      }),
      deps.db.user.findUnique({
        where: { id: params.userId },
        select: {
          telegramChatId: true
        }
      }),
      deps.getDailyEconomicCalendarSettingsForUser(params.userId),
      deps.getNotificationPluginSettingsForUser(params.userId),
      deps.getNotificationDestinationsSettingsForUser(params.userId),
      getTelegramLinkStatus({
        db: deps.db,
        userId: params.userId,
        botUsername: resolveTelegramBotUsername()
      })
    ]);
    const envToken = parseTelegramConfigValue(process.env.TELEGRAM_BOT_TOKEN);
    const dbToken = parseTelegramConfigValue(config?.telegramBotToken);

    return {
      telegramBotToken: params.isSuperadmin ? dbToken : null,
      telegramBotConfigured: Boolean(envToken ?? dbToken),
      telegramBotUsername: resolveTelegramBotUsername(),
      telegramChatId: userSettings?.telegramChatId ?? null,
      telegramLink,
      telegramManualFallbackEnabled: true,
      telegramLinkTtlMinutes: resolveTelegramLinkTtlMinutes(),
      notificationPlugins,
      notificationDestinations: deps.toNotificationDestinationsSettingsResponse(notificationDestinations),
      dailyEconomicCalendar: deps.toDailyEconomicCalendarSettingsResponse(dailyEconomicCalendar)
    };
  };

  app.get("/settings/security", requireAuth, async (_req, res) => {
    const user = getUserFromLocals(res);
    const [row, global, ctx, userOverride] = await Promise.all([
      deps.db.user.findUnique({
        where: { id: user.id },
        select: {
          autoLogoutEnabled: true,
          autoLogoutMinutes: true
        }
      }),
      deps.getSecurityGlobalSettings(),
      deps.resolveUserContext(user),
      deps.getSecurityUserReauthOverride(user.id)
    ]);

    const effectiveReauthOtpEnabled =
      userOverride === null ? global.reauthOtpEnabled : userOverride;

    return res.json({
      autoLogoutEnabled: row?.autoLogoutEnabled ?? true,
      autoLogoutMinutes: row?.autoLogoutMinutes ?? 60,
      reauthOtpEnabled: effectiveReauthOtpEnabled,
      isSuperadmin: ctx.isSuperadmin
    });
  });

  app.put("/settings/security", requireAuth, async (req, res) => {
    const user = getUserFromLocals(res);
    const parsed = securitySettingsSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return res.status(400).json({ error: "invalid_payload", details: parsed.error.flatten() });
    }

    const ctx = await deps.resolveUserContext(user);
    const nextUserFields: Record<string, unknown> = {};
    if (typeof parsed.data.autoLogoutEnabled === "boolean") {
      nextUserFields.autoLogoutEnabled = parsed.data.autoLogoutEnabled;
    }
    if (typeof parsed.data.autoLogoutMinutes === "number") {
      nextUserFields.autoLogoutMinutes = parsed.data.autoLogoutMinutes;
    }
    if (Object.keys(nextUserFields).length > 0) {
      await deps.db.user.update({
        where: { id: user.id },
        data: nextUserFields
      });
    }

    const global = await deps.getSecurityGlobalSettings();
    let nextReauthEnabled = global.reauthOtpEnabled;
    if (typeof parsed.data.reauthOtpEnabled === "boolean") {
      nextReauthEnabled = parsed.data.reauthOtpEnabled;
      if (ctx.isSuperadmin) {
        await deps.setSecurityGlobalSettings({ reauthOtpEnabled: parsed.data.reauthOtpEnabled });
      } else {
        await deps.setSecurityUserReauthOverride(user.id, parsed.data.reauthOtpEnabled);
      }
    } else {
      const userOverride = await deps.getSecurityUserReauthOverride(user.id);
      nextReauthEnabled = userOverride === null ? global.reauthOtpEnabled : userOverride;
    }

    const updated = await deps.db.user.findUnique({
      where: { id: user.id },
      select: {
        autoLogoutEnabled: true,
        autoLogoutMinutes: true
      }
    });

    return res.json({
      autoLogoutEnabled: updated?.autoLogoutEnabled ?? true,
      autoLogoutMinutes: updated?.autoLogoutMinutes ?? 60,
      reauthOtpEnabled: nextReauthEnabled,
      isSuperadmin: ctx.isSuperadmin
    });
  });

  app.get("/settings/sessions", requireAuth, async (req, res) => {
    const user = getUserFromLocals(res);
    const currentToken = typeof req.cookies?.[SESSION_COOKIE] === "string"
      ? req.cookies[SESSION_COOKIE]
      : "";
    const currentTokenHash = currentToken ? hashSessionToken(currentToken) : null;
    const rows = await deps.db.session.findMany({
      where: { userId: user.id },
      orderBy: [
        { lastActiveAt: "desc" },
        { createdAt: "desc" }
      ],
      take: 50,
      select: {
        id: true,
        createdAt: true,
        lastActiveAt: true,
        expiresAt: true,
        tokenHash: true
      }
    });
    const now = Date.now();

    return res.json({
      items: rows.map((row: any) => ({
        id: String(row.id),
        createdAt: isoOrNull(row.createdAt),
        lastActiveAt: isoOrNull(row.lastActiveAt),
        expiresAt: isoOrNull(row.expiresAt),
        isCurrent: Boolean(currentTokenHash && row.tokenHash === currentTokenHash),
        expired: row.expiresAt instanceof Date ? row.expiresAt.getTime() < now : false
      }))
    });
  });

  app.delete("/settings/sessions", requireAuth, async (req, res) => {
    const user = getUserFromLocals(res);
    const scope = typeof req.query?.scope === "string" ? req.query.scope.trim().toLowerCase() : "";
    if (scope !== "others") {
      return res.status(400).json({ error: "invalid_scope" });
    }
    const currentToken = typeof req.cookies?.[SESSION_COOKIE] === "string"
      ? req.cookies[SESSION_COOKIE]
      : "";
    const currentTokenHash = currentToken ? hashSessionToken(currentToken) : null;
    if (!currentTokenHash) {
      return res.status(400).json({ error: "current_session_missing" });
    }

    const result = await deps.db.session.deleteMany({
      where: {
        userId: user.id,
        tokenHash: { not: currentTokenHash }
      }
    });
    return res.json({ ok: true, deletedCount: result?.count ?? 0 });
  });

  app.delete("/settings/sessions/:id", requireAuth, async (req, res) => {
    const user = getUserFromLocals(res);
    const sessionId = String(req.params?.id ?? "").trim();
    if (!sessionId) return res.status(400).json({ error: "invalid_session_id" });
    const row = await deps.db.session.findFirst({
      where: { id: sessionId, userId: user.id },
      select: { id: true, tokenHash: true }
    });
    if (!row) return res.status(404).json({ error: "session_not_found" });

    const currentToken = typeof req.cookies?.[SESSION_COOKIE] === "string"
      ? req.cookies[SESSION_COOKIE]
      : "";
    const currentTokenHash = currentToken ? hashSessionToken(currentToken) : null;
    if (currentTokenHash && row.tokenHash === currentTokenHash) {
      return res.status(400).json({ error: "current_session_cannot_be_revoked_here" });
    }

    await deps.db.session.deleteMany({
      where: { id: row.id, userId: user.id }
    });
    return res.json({ ok: true });
  });

  app.get("/settings/legal-acknowledgements", requireAuth, async (_req, res) => {
    const user = getUserFromLocals(res);
    const rows = await deps.db.userLegalAcknowledgement.findMany({
      where: { userId: user.id },
      orderBy: [{ acceptedAt: "desc" }],
      take: 5,
      select: {
        id: true,
        version: true,
        textHash: true,
        acceptedAt: true,
        createdAt: true
      }
    });
    const items = rows.map((row: any) => ({
      id: String(row.id),
      version: String(row.version ?? ""),
      textHash: String(row.textHash ?? ""),
      acceptedAt: isoOrNull(row.acceptedAt),
      createdAt: isoOrNull(row.createdAt)
    }));

    return res.json({
      currentVersion: LEGAL_ACKNOWLEDGEMENT_VERSION,
      latest: items[0] ?? null,
      items
    });
  });

  app.get("/settings/mobile-push", requireAuth, async (_req, res) => {
    const user = getUserFromLocals(res);
    const rows = await deps.db.mobilePushToken.findMany({
      where: { userId: user.id },
      orderBy: [
        { lastSeenAt: "desc" },
        { createdAt: "desc" }
      ],
      take: 20,
      select: {
        id: true,
        platform: true,
        environment: true,
        bundleId: true,
        deviceId: true,
        appVersion: true,
        enabled: true,
        lastSeenAt: true,
        revokedAt: true,
        createdAt: true
      }
    });
    const tokens = rows.map(toMobilePushTokenDto);

    return res.json({
      enabled: tokens.some((token) => token.enabled && !token.revokedAt),
      apnsConfigured: isApnsConfiguredFn(),
      environment: normalizePushEnvironment(null),
      bundleId: process.env.APNS_BUNDLE_ID ?? null,
      tokens
    });
  });

  app.delete("/settings/mobile-push/:id", requireAuth, async (req, res) => {
    const user = getUserFromLocals(res);
    const tokenId = String(req.params?.id ?? "").trim();
    if (!tokenId) return res.status(400).json({ error: "invalid_token_id" });

    const result = await deps.db.mobilePushToken.updateMany({
      where: {
        id: tokenId,
        userId: user.id,
        revokedAt: null
      },
      data: {
        enabled: false,
        revokedAt: new Date()
      }
    });
    if ((result?.count ?? 0) < 1) {
      return res.status(404).json({ error: "push_token_not_found" });
    }
    return res.json({ ok: true });
  });

  async function buildAccountDeletionSummary(userId: string) {
    const [
      runningBots,
      activeGridBots,
      activeBotVaults,
      fundedBotVaults,
      fundedFundingVaults
    ] = await Promise.all([
      deps.db.bot.count({
        where: {
          userId,
          status: "running"
        }
      }).catch(() => 0),
      deps.db.gridBotInstance.count({
        where: {
          userId,
          state: { in: ["created", "running", "funding_pending", "paused", "error"] }
        }
      }).catch(() => 0),
      deps.db.botVault.count({
        where: {
          userId,
          status: { in: ["ACTIVE", "PAUSED", "CLOSE_ONLY", "ERROR"] }
        }
      }).catch(() => 0),
      deps.db.botVault.count({
        where: {
          userId,
          OR: [
            { availableUsd: { gt: 0.000001 } },
            { allocatedUsd: { gt: 0.000001 } },
            { principalAllocated: { gt: 0.000001 } },
            { profitShareAccruedUsd: { gt: 0.000001 } }
          ]
        }
      }).catch(() => 0),
      deps.db.fundingVault.count({
        where: {
          userId,
          OR: [
            { freeBalance: { gt: 0.000001 } },
            { reservedBalance: { gt: 0.000001 } }
          ]
        }
      }).catch(() => 0)
    ]);
    const blockers = [
      runningBots > 0 ? { code: "running_bots", count: runningBots } : null,
      activeGridBots > 0 ? { code: "active_grid_bots", count: activeGridBots } : null,
      activeBotVaults > 0 ? { code: "active_bot_vaults", count: activeBotVaults } : null,
      fundedBotVaults > 0 ? { code: "funded_bot_vaults", count: fundedBotVaults } : null,
      fundedFundingVaults > 0 ? { code: "funded_funding_vaults", count: fundedFundingVaults } : null
    ].filter(Boolean);

    return {
      canDelete: blockers.length === 0,
      blockers
    };
  }

  app.get("/settings/account-deletion", requireAuth, async (_req, res) => {
    const user = getUserFromLocals(res);
    const ctx = await deps.resolveUserContext(user);
    const summary = await buildAccountDeletionSummary(user.id);

    return res.json({
      ...summary,
      superadminBlocked: ctx.isSuperadmin
    });
  });

  app.post("/settings/account/delete", requireAuth, async (req, res) => {
    const user = getUserFromLocals(res);
    const parsed = accountDeletionSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return res.status(400).json({ error: "invalid_payload", details: parsed.error.flatten() });
    }
    if (parsed.data.confirmText !== "DELETE") {
      return res.status(400).json({ error: "invalid_confirmation_text" });
    }
    if (normalizeEmail(parsed.data.confirmEmail) !== normalizeEmail(user.email)) {
      return res.status(400).json({ error: "email_confirmation_mismatch" });
    }

    const ctx = await deps.resolveUserContext(user);
    if (ctx.isSuperadmin) {
      return res.status(403).json({ error: "superadmin_account_deletion_blocked" });
    }

    const summary = await buildAccountDeletionSummary(user.id);
    if (!summary.canDelete) {
      return res.status(409).json({ error: "account_deletion_blocked", blockers: summary.blockers });
    }

    const deletedAt = new Date();
    const deletedEmail = `deleted-${user.id}-${deletedAt.getTime()}@deleted.local`;
    await deps.db.$transaction(async (tx: any) => {
      await Promise.all([
        tx.session.deleteMany({ where: { userId: user.id } }),
        tx.reauthSession.deleteMany({ where: { userId: user.id } }),
        tx.reauthOtp.deleteMany({ where: { userId: user.id } }),
        tx.mobilePushToken.deleteMany({ where: { userId: user.id } }),
        tx.telegramLinkSession.deleteMany({ where: { userId: user.id } }),
        tx.userAiPromptTemplate.deleteMany({ where: { userId: user.id } }).catch(() => ({ count: 0 })),
        tx.mobileWatchlistItem.deleteMany({ where: { userId: user.id } }).catch(() => ({ count: 0 })),
        tx.gridTemplateFavorite.deleteMany({ where: { userId: user.id } }).catch(() => ({ count: 0 })),
        tx.globalSetting.deleteMany({
          where: {
            OR: accountDeletionGlobalSettingFilters(user.id)
          }
        }).catch(() => ({ count: 0 })),
        tx.siweNonce.updateMany({
          where: { issuedForUserId: user.id },
          data: { issuedForUserId: null }
        }).catch(() => ({ count: 0 })),
        tx.userSubscription.updateMany({
          where: { userId: user.id },
          data: {
            effectivePlan: "FREE",
            status: "INACTIVE",
            maxRunningBots: 0,
            maxRunningPredictionsAi: 0,
            maxRunningPredictionsComposite: 0,
            aiTokenBalance: 0
          }
        }).catch(() => ({ count: 0 })),
        tx.affiliateProfile.updateMany({
          where: { userId: user.id },
          data: { status: "DISABLED" }
        }).catch(() => ({ count: 0 }))
      ]);

      await tx.exchangeAccount.updateMany({
        where: { userId: user.id },
        data: {
          label: "Deleted account",
          apiKeyEnc: "deleted",
          apiSecretEnc: "deleted",
          passphraseEnc: null
        }
      }).catch(() => ({ count: 0 }));

      await tx.user.update({
        where: { id: user.id },
        data: {
          email: deletedEmail,
          walletAddress: null,
          passwordHash: null,
          telegramChatId: null,
          emailVerifiedAt: null,
          allowManualTrading: false,
          agentWallet: null,
          agentSecretRef: null,
          agentLastBalanceAt: null,
          agentLastBalanceWei: null,
          agentLastBalanceFormatted: null
        }
      });
    });

    res.clearCookie(SESSION_COOKIE, { path: "/" });
    return res.json({ ok: true, deletedAt: deletedAt.toISOString() });
  });

  app.get("/settings/exchange-options", requireAuth, async (_req, res) => {
    const allowed = await deps.getAllowedExchangeValues();
    return res.json({
      allowed,
      options: deps.getExchangeOptionsResponse(allowed)
    });
  });

  app.get("/settings/server-info", requireAuth, async (_req, res) => {
    const settings = await deps.getServerInfoSettings();
    return res.json({
      serverIpAddress: settings.serverIpAddress
    });
  });

  app.get("/settings/alerts", requireAuth, async (_req, res) => {
    const user = getUserFromLocals(res);
    const isSuperadmin = deps.isSuperadminEmail(user.email);
    return res.json(await buildAlertsResponse({
      userId: user.id,
      isSuperadmin
    }));
  });

  app.put("/settings/alerts", requireAuth, async (req, res) => {
    const user = getUserFromLocals(res);
    const isSuperadmin = deps.isSuperadminEmail(user.email);
    const parsed = alertsSettingsSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return res.status(400).json({ error: "invalid_payload", details: parsed.error.flatten() });
    }

    const requestedToken = parseTelegramConfigValue(parsed.data.telegramBotToken);
    const requestedChatId = normalizeTelegramChatId(parsed.data.telegramChatId);
    const chatIdConflict = await findTelegramChatIdConflictFromDeps({
      chatId: requestedChatId,
      currentUserId: user.id,
      includeGlobal: true,
      deps: {
        findUserByChatId: async (input) =>
          deps.db.user.findFirst({
            where: {
              telegramChatId: input.chatId,
              ...(input.excludingUserId ? { id: { not: input.excludingUserId } } : {})
            },
            select: { id: true }
          }),
        getGlobalChatId: async () => {
          const config = await deps.db.alertConfig.findUnique({
            where: { key: "default" },
            select: { telegramChatId: true }
          });
          return normalizeTelegramChatId(config?.telegramChatId);
        }
      }
    });
    if (chatIdConflict) {
      return buildTelegramChatIdConflictResponse(res);
    }
    const hasTokenUpdate = Object.prototype.hasOwnProperty.call(parsed.data, "telegramBotToken");
    const existingConfig = await deps.db.alertConfig.findUnique({
      where: { key: "default" },
      select: {
        telegramBotToken: true,
        telegramChatId: true
      }
    });
    const existingUser = await deps.db.user.findUnique({
      where: { id: user.id },
      select: {
        telegramChatId: true
      }
    });
    let updatedUser: { telegramChatId: string | null };
    try {
      updatedUser = await deps.db.user.update({
        where: { id: user.id },
        data: {
          telegramChatId: requestedChatId
        },
        select: {
          telegramChatId: true
        }
      });
    } catch (error) {
      if (isPrismaUniqueConstraintError(error)) {
        return buildTelegramChatIdConflictResponse(res);
      }
      throw error;
    }

    let token = parseTelegramConfigValue(existingConfig?.telegramBotToken);
    if (isSuperadmin && hasTokenUpdate) {
      const updatedConfig = await deps.db.alertConfig.upsert({
        where: { key: "default" },
        create: {
          key: "default",
          telegramBotToken: requestedToken,
          telegramChatId: normalizeTelegramChatId(existingConfig?.telegramChatId)
        },
        update: {
          telegramBotToken: requestedToken
        },
        select: {
          telegramBotToken: true
        }
      });
      token = parseTelegramConfigValue(updatedConfig.telegramBotToken);
    }

    if (normalizeTelegramChatId(existingUser?.telegramChatId) !== updatedUser.telegramChatId) {
      await invalidateOpenTelegramLinkSessions({
        db: deps.db,
        userId: user.id
      });
    }

    const dailyEconomicCalendar = parsed.data.dailyEconomicCalendar !== undefined
      ? await deps.updateDailyEconomicCalendarSettingsForUser({
          userId: user.id,
          patch: parsed.data.dailyEconomicCalendar as Record<string, unknown>
        })
      : await deps.getDailyEconomicCalendarSettingsForUser(user.id);
    const notificationPlugins = parsed.data.notificationPlugins !== undefined
      ? await deps.updateNotificationPluginSettingsForUser({
          userId: user.id,
          patch: parsed.data.notificationPlugins as Record<string, unknown>
        })
      : await deps.getNotificationPluginSettingsForUser(user.id);
    const notificationDestinations = parsed.data.notificationDestinations !== undefined
      ? await deps.updateNotificationDestinationsSettingsForUser({
          userId: user.id,
          patch: parsed.data.notificationDestinations as Record<string, unknown>
        })
      : await deps.getNotificationDestinationsSettingsForUser(user.id);

    const alertsPayload = await buildAlertsResponse({
      userId: user.id,
      isSuperadmin
    });

    return res.json({
      ...alertsPayload,
      telegramBotToken: isSuperadmin ? token : null,
      notificationPlugins,
      notificationDestinations: deps.toNotificationDestinationsSettingsResponse(notificationDestinations),
      dailyEconomicCalendar: deps.toDailyEconomicCalendarSettingsResponse(dailyEconomicCalendar)
    });
  });

  app.post("/settings/alerts/telegram/link", requireAuth, async (_req, res) => {
    const user = getUserFromLocals(res);
    const botUsername = resolveTelegramBotUsername();
    const config = await deps.db.alertConfig.findUnique({
      where: { key: "default" },
      select: { telegramBotToken: true }
    });
    const envToken = parseTelegramConfigValue(process.env.TELEGRAM_BOT_TOKEN);
    const configuredToken = envToken ?? parseTelegramConfigValue(config?.telegramBotToken);
    if (!configuredToken || !botUsername) {
      return res.status(400).json({
        error: "telegram_linking_not_available",
        details: "Telegram bot token or bot username is not configured."
      });
    }

    const link = await createTelegramLinkSession({
      db: deps.db,
      userId: user.id,
      botUsername
    });
    return res.json(link);
  });

  app.get("/settings/alerts/telegram/link", requireAuth, async (_req, res) => {
    const user = getUserFromLocals(res);
    return res.json(await getTelegramLinkStatus({
      db: deps.db,
      userId: user.id,
      botUsername: resolveTelegramBotUsername()
    }));
  });

  app.delete("/settings/alerts/telegram/link", requireAuth, async (_req, res) => {
    const user = getUserFromLocals(res);
    await deps.db.user.update({
      where: { id: user.id },
      data: {
        telegramChatId: null
      }
    });
    await invalidateOpenTelegramLinkSessions({
      db: deps.db,
      userId: user.id
    });
    return res.json(await getTelegramLinkStatus({
      db: deps.db,
      userId: user.id,
      botUsername: resolveTelegramBotUsername()
    }));
  });

  app.post("/alerts/test", requireAuth, async (_req, res) => {
    const user = getUserFromLocals(res);
    const config = await resolveTelegramConfigFn(user.id);
    if (!config) {
      return res.status(400).json({
        error: "telegram_not_configured",
        details: "Telegram bot token must be configured and your account must be linked to Telegram."
      });
    }

    try {
      await sendTelegramMessageFn({
        ...config,
        text: [
          "uLiquid Desk Telegram test",
          `User: ${user.email}`,
          `Time: ${new Date().toISOString()}`
        ].join("\n")
      });
      return res.json({ ok: true });
    } catch (error) {
      return res.status(502).json({
        error: "telegram_send_failed",
        details: String(error)
      });
    }
  });

  app.get("/admin/settings/access-section", requireAuth, async (_req, res) => {
    if (!(await deps.requireSuperadmin(res))) return;
    const row = await deps.db.globalSetting.findUnique({
      where: { key: deps.GLOBAL_SETTING_ACCESS_SECTION_KEY },
      select: { value: true, updatedAt: true }
    });
    const settings = deps.toEffectiveAccessSectionSettings(
      deps.parseStoredAccessSectionSettings(row?.value)
    );
    return res.json({
      visibility: settings.visibility,
      maintenance: settings.maintenance,
      updatedAt: row?.updatedAt ?? null,
      source: row ? "db" : "default",
      defaults: {
        visibility: deps.DEFAULT_ACCESS_SECTION_SETTINGS.visibility,
        maintenance: deps.DEFAULT_ACCESS_SECTION_SETTINGS.maintenance
      }
    });
  });

  app.put("/admin/settings/access-section", requireAuth, async (req, res) => {
    if (!(await deps.requireSuperadmin(res))) return;
    const parsed = adminAccessSectionSettingsSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return res.status(400).json({ error: "invalid_payload", details: parsed.error.flatten() });
    }
    const value = deps.toEffectiveAccessSectionSettings(deps.parseStoredAccessSectionSettings(parsed.data));
    const updated = await deps.setGlobalSettingValue(deps.GLOBAL_SETTING_ACCESS_SECTION_KEY, value);
    const settings = deps.toEffectiveAccessSectionSettings(
      deps.parseStoredAccessSectionSettings(updated.value)
    );
    return res.json({
      visibility: settings.visibility,
      maintenance: settings.maintenance,
      updatedAt: updated.updatedAt,
      source: "db",
      defaults: {
        visibility: deps.DEFAULT_ACCESS_SECTION_SETTINGS.visibility,
        maintenance: deps.DEFAULT_ACCESS_SECTION_SETTINGS.maintenance
      }
    });
  });

  app.get("/admin/settings/server-info", requireAuth, async (_req, res) => {
    if (!(await deps.requireSuperadmin(res))) return;
    const settings = await deps.getServerInfoSettings();
    return res.json(settings);
  });

  app.put("/admin/settings/server-info", requireAuth, async (req, res) => {
    if (!(await deps.requireSuperadmin(res))) return;
    const parsed = adminServerInfoSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return res.status(400).json({ error: "invalid_payload", details: parsed.error.flatten() });
    }
    const normalized = deps.normalizeServerIpAddress(parsed.data.serverIpAddress);
    await deps.setGlobalSettingValue(deps.GLOBAL_SETTING_SERVER_INFO_KEY, {
      serverIpAddress: normalized
    });
    const settings = await deps.getServerInfoSettings();
    return res.json(settings);
  });

  app.get("/settings/access-section", requireAuth, async (_req, res) => {
    const user = getUserFromLocals(res);
    const bypass = await deps.evaluateAccessSectionBypassForUser(user);
    const [settings, usage] = await Promise.all([
      deps.getAccessSectionSettings(),
      deps.getAccessSectionUsageForUser(user.id)
    ]);

    const visibility = bypass
      ? deps.DEFAULT_ACCESS_SECTION_SETTINGS.visibility
      : settings.visibility;

    return res.json({
      bypass,
      visibility,
      maintenance: {
        enabled: settings.maintenance.enabled,
        activeForUser: settings.maintenance.enabled && !bypass
      },
      usage
    });
  });
}
