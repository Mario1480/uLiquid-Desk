import express from "express";
import { z } from "zod";
import { getUserFromLocals, requireAuth } from "../auth.js";
import {
  findTelegramChatIdConflict as findTelegramChatIdConflictFromDeps,
  isPrismaUniqueConstraintError,
  normalizeTelegramChatId,
  TELEGRAM_CHAT_ID_IN_USE_ERROR
} from "../telegram/chatIdUniqueness.js";
import { resolveTelegramConfig, sendTelegramMessage } from "../telegram/notifications.js";

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
};

export function registerSettingsCoreRoutes(
  app: express.Express,
  deps: RegisterSettingsCoreRoutesDeps
) {
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
    const [config, userSettings, dailyEconomicCalendar, notificationPlugins, notificationDestinations] = await Promise.all([
      deps.db.alertConfig.findUnique({
        where: { key: "default" },
        select: {
          telegramBotToken: true
        }
      }),
      deps.db.user.findUnique({
        where: { id: user.id },
        select: {
          telegramChatId: true
        }
      }),
      deps.getDailyEconomicCalendarSettingsForUser(user.id),
      deps.getNotificationPluginSettingsForUser(user.id),
      deps.getNotificationDestinationsSettingsForUser(user.id)
    ]);
    const envToken = parseTelegramConfigValue(process.env.TELEGRAM_BOT_TOKEN);
    const dbToken = parseTelegramConfigValue(config?.telegramBotToken);

    return res.json({
      telegramBotToken: isSuperadmin ? dbToken : null,
      telegramBotConfigured: Boolean(envToken ?? dbToken),
      telegramChatId: userSettings?.telegramChatId ?? null,
      notificationPlugins,
      notificationDestinations: deps.toNotificationDestinationsSettingsResponse(notificationDestinations),
      dailyEconomicCalendar: deps.toDailyEconomicCalendarSettingsResponse(dailyEconomicCalendar)
    });
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

    const envToken = parseTelegramConfigValue(process.env.TELEGRAM_BOT_TOKEN);

    return res.json({
      telegramBotToken: isSuperadmin ? token : null,
      telegramBotConfigured: Boolean(envToken ?? token),
      telegramChatId: updatedUser.telegramChatId ?? null,
      notificationPlugins,
      notificationDestinations: deps.toNotificationDestinationsSettingsResponse(notificationDestinations),
      dailyEconomicCalendar: deps.toDailyEconomicCalendarSettingsResponse(dailyEconomicCalendar)
    });
  });

  app.post("/alerts/test", requireAuth, async (_req, res) => {
    const user = getUserFromLocals(res);
    const config = await resolveTelegramConfig(user.id);
    if (!config) {
      return res.status(400).json({
        error: "telegram_not_configured",
        details: "Admin bot token plus your personal telegramChatId are required."
      });
    }

    try {
      await sendTelegramMessage({
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
