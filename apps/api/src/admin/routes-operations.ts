import express from "express";
import { z } from "zod";
import { getFuturesVenueCapabilities } from "@mm/futures-exchange";
import { getUserFromLocals, requireAuth } from "../auth.js";

const adminUserCreateSchema = z.object({
  email: z.string().trim().email(),
  password: z.string().trim().min(8).optional()
});

const adminUserPasswordSchema = z.object({
  password: z.string().trim().min(8)
});

const adminUserAdminAccessSchema = z.object({
  enabled: z.boolean().default(false)
});

const adminTelegramSchema = z.object({
  telegramBotToken: z.string().trim().nullable().optional(),
  telegramChatId: z.string().trim().nullable().optional()
}).superRefine((value, ctx) => {
  const token = typeof value.telegramBotToken === "string" ? value.telegramBotToken.trim() : "";
  const chatId = typeof value.telegramChatId === "string" ? value.telegramChatId.trim() : "";
  if ((token && !chatId) || (!token && chatId)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "telegramBotToken and telegramChatId must both be set or both be empty"
    });
  }
});

const adminExchangesSchema = z.object({
  allowed: z.array(z.string().trim().min(1)).min(1).max(20)
});

const adminSmtpSchema = z.object({
  host: z.string().trim().min(1),
  port: z.number().int().min(1).max(65535),
  user: z.string().trim().min(1),
  from: z.string().trim().min(1),
  secure: z.boolean().default(true),
  password: z.string().trim().min(1).optional()
});

const adminSmtpTestSchema = z.object({
  to: z.string().trim().email()
});

export type RegisterAdminOperationsRoutesDeps = {
  db: any;
  requireSuperadmin(res: express.Response): Promise<boolean>;
  recordAdminAuditEvent(input: {
    actorUserId: string;
    action: string;
    targetType: string;
    targetId?: string | null;
    targetLabel?: string | null;
    workspaceId?: string | null;
    metadata?: Record<string, unknown> | null;
    ip?: string | null;
  }): Promise<void>;
  getAdminBackendAccessUserIdSet(): Promise<Set<string>>;
  isSuperadminEmail(email: string): boolean;
  hashPassword(password: string): Promise<string>;
  generateTempPassword(): string;
  ensureWorkspaceMembership(userId: string, email: string): Promise<{ workspaceId: string }>;
  ignoreMissingTable<T>(operation: () => Promise<T>): Promise<T | null>;
  getGlobalSettingValue(key: string): Promise<unknown>;
  setGlobalSettingValue(key: string, value: unknown): Promise<any>;
  GLOBAL_SETTING_ADMIN_BACKEND_ACCESS_KEY: string;
  parseStoredAdminBackendAccess(value: unknown): { userIds: string[] };
  parseTelegramConfigValue(value: unknown): string | null;
  normalizeTelegramChatId(value: unknown): string | null;
  findTelegramChatIdConflict(params: {
    chatId: string | null;
    currentUserId: string | null;
    includeGlobal: boolean;
  }): Promise<unknown>;
  buildTelegramChatIdConflictResponse(res: express.Response): express.Response;
  maskSecret(value: string): string;
  resolveTelegramConfig(): Promise<{ telegramBotToken: string; telegramChatId: string } | null>;
  sendTelegramMessage(params: { telegramBotToken: string; telegramChatId: string; text: string }): Promise<void>;
  getAllowedExchangeValues(): Promise<string[]>;
  normalizeExchangeValue(value: string): string;
  EXCHANGE_OPTION_VALUES: Set<string>;
  getRuntimeEnabledExchangeValues(): Set<string>;
  GLOBAL_SETTING_EXCHANGES_KEY: string;
  getExchangeOptionsResponse(allowed: string[]): any;
  GLOBAL_SETTING_SMTP_KEY: string;
  parseStoredSmtpSettings(value: unknown): { host: string | null; port: number | null; user: string | null; from: string | null; secure: boolean; passEnc: string | null };
  toPublicSmtpSettings(settings: {
    host: string | null;
    port: number | null;
    user: string | null;
    from: string | null;
    secure: boolean;
    passEnc: string | null;
  }): any;
  encryptSecret(value: string): string;
  sendSmtpTestEmail(params: { to: string; subject: string; text: string }): Promise<{ ok: boolean; error?: string }>;
};

export function registerAdminOperationsRoutes(
  app: express.Express,
  deps: RegisterAdminOperationsRoutesDeps
) {
  app.get("/admin/users", requireAuth, async (_req, res) => {
    if (!(await deps.requireSuperadmin(res))) return;
    const adminAccessIds = await deps.getAdminBackendAccessUserIdSet();

    const users = await deps.db.user.findMany({
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        email: true,
        createdAt: true,
        updatedAt: true,
        workspaces: {
          select: {
            workspaceId: true
          }
        },
        _count: {
          select: {
            sessions: true,
            exchangeAccounts: true,
            bots: true,
            workspaces: true
          }
        }
      }
    });

    const rows = users.map((row: any) => ({
      id: row.id,
      email: row.email,
      isSuperadmin: deps.isSuperadminEmail(row.email),
      hasAdminBackendAccess: deps.isSuperadminEmail(row.email) || adminAccessIds.has(row.id),
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      sessions: row._count?.sessions ?? 0,
      exchangeAccounts: row._count?.exchangeAccounts ?? 0,
      bots: row._count?.bots ?? 0,
      workspaceMemberships: row._count?.workspaces ?? 0,
      workspaceIds: Array.isArray(row.workspaces)
        ? row.workspaces
            .map((membership: any) => String(membership?.workspaceId ?? "").trim())
            .filter(Boolean)
        : []
    }));

    return res.json({ items: rows });
  });

  app.post("/admin/users", requireAuth, async (req, res) => {
    if (!(await deps.requireSuperadmin(res))) return;
    const actor = getUserFromLocals(res);
    const parsed = adminUserCreateSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return res.status(400).json({ error: "invalid_payload", details: parsed.error.flatten() });
    }

    const email = parsed.data.email.toLowerCase();
    const existing = await deps.db.user.findUnique({ where: { email } });
    if (existing) {
      return res.status(409).json({ error: "email_already_exists" });
    }

    const generated = !parsed.data.password;
    const password = parsed.data.password ?? deps.generateTempPassword();
    const passwordHash = await deps.hashPassword(password);

    const created = await deps.db.user.create({
      data: {
        email,
        passwordHash,
        emailVerifiedAt: new Date()
      },
      select: {
        id: true,
        email: true,
        createdAt: true
      }
    });
    const membership = await deps.ensureWorkspaceMembership(created.id, created.email);
    await deps.recordAdminAuditEvent({
      actorUserId: actor.id,
      action: "admin.user.created",
      targetType: "user",
      targetId: created.id,
      targetLabel: created.email,
      workspaceId: membership.workspaceId,
      metadata: { generatedTemporaryPassword: generated },
      ip: req.ip ?? null
    });

    return res.status(201).json({
      user: {
        id: created.id,
        email: created.email,
        createdAt: created.createdAt,
        workspaceId: membership.workspaceId
      },
      temporaryPassword: generated ? password : null
    });
  });

  app.put("/admin/users/:id/password", requireAuth, async (req, res) => {
    if (!(await deps.requireSuperadmin(res))) return;
    const actor = getUserFromLocals(res);
    const id = req.params.id;
    const parsed = adminUserPasswordSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return res.status(400).json({ error: "invalid_payload", details: parsed.error.flatten() });
    }

    const user = await deps.db.user.findUnique({
      where: { id },
      select: { id: true }
    });
    if (!user) return res.status(404).json({ error: "user_not_found" });

    await deps.db.user.update({
      where: { id },
      data: {
        passwordHash: await deps.hashPassword(parsed.data.password)
      }
    });

    await deps.db.session.deleteMany({
      where: { userId: id }
    });
    await deps.recordAdminAuditEvent({
      actorUserId: actor.id,
      action: "admin.user.password_reset",
      targetType: "user",
      targetId: id,
      metadata: { sessionsRevoked: true },
      ip: req.ip ?? null
    });

    return res.json({ ok: true, sessionsRevoked: true });
  });

  app.put("/admin/users/:id/admin-access", requireAuth, async (req, res) => {
    if (!(await deps.requireSuperadmin(res))) return;
    const actor = getUserFromLocals(res);
    const id = req.params.id;
    const parsed = adminUserAdminAccessSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return res.status(400).json({ error: "invalid_payload", details: parsed.error.flatten() });
    }

    const user = await deps.db.user.findUnique({
      where: { id },
      select: { id: true, email: true }
    });
    if (!user) return res.status(404).json({ error: "user_not_found" });
    if (deps.isSuperadminEmail(user.email)) {
      return res.status(400).json({ error: "cannot_change_superadmin_admin_access" });
    }

    const settings = deps.parseStoredAdminBackendAccess(
      await deps.getGlobalSettingValue(deps.GLOBAL_SETTING_ADMIN_BACKEND_ACCESS_KEY)
    );
    const ids = new Set(settings.userIds);
    if (parsed.data.enabled) {
      ids.add(user.id);
    } else {
      ids.delete(user.id);
      if (actor.id === user.id) {
        await deps.db.session.deleteMany({ where: { userId: user.id } });
      }
    }
    const next = { userIds: Array.from(ids) };
    await deps.setGlobalSettingValue(deps.GLOBAL_SETTING_ADMIN_BACKEND_ACCESS_KEY, next);
    await deps.recordAdminAuditEvent({
      actorUserId: actor.id,
      action: "admin.user.admin_access_updated",
      targetType: "user",
      targetId: user.id,
      targetLabel: user.email,
      metadata: { enabled: parsed.data.enabled },
      ip: req.ip ?? null
    });

    return res.json({
      ok: true,
      userId: user.id,
      hasAdminBackendAccess: parsed.data.enabled
    });
  });

  app.delete("/admin/users/:id", requireAuth, async (req, res) => {
    if (!(await deps.requireSuperadmin(res))) return;
    const actor = getUserFromLocals(res);
    const id = req.params.id;

    const user = await deps.db.user.findUnique({
      where: { id },
      select: { id: true, email: true }
    });
    if (!user) return res.status(404).json({ error: "user_not_found" });
    if (deps.isSuperadminEmail(user.email)) {
      return res.status(400).json({ error: "cannot_delete_superadmin" });
    }
    if (user.id === actor.id) {
      return res.status(400).json({ error: "cannot_delete_self" });
    }

    const bots = await deps.db.bot.findMany({
      where: { userId: user.id },
      select: { id: true }
    });
    const botIds = bots.map((row: any) => row.id);

    await deps.db.$transaction(async (tx: any) => {
      if (botIds.length > 0) {
        await deps.ignoreMissingTable(() => tx.botMetric.deleteMany({ where: { botId: { in: botIds } } }));
        await deps.ignoreMissingTable(() => tx.botAlert.deleteMany({ where: { botId: { in: botIds } } }));
        await deps.ignoreMissingTable(() => tx.riskEvent.deleteMany({ where: { botId: { in: botIds } } }));
        await deps.ignoreMissingTable(() => tx.botRuntime.deleteMany({ where: { botId: { in: botIds } } }));
        await deps.ignoreMissingTable(() => tx.botTradeHistory.deleteMany({ where: { botId: { in: botIds } } }));
        await deps.ignoreMissingTable(() => tx.futuresBotConfig.deleteMany({ where: { botId: { in: botIds } } }));
        await deps.ignoreMissingTable(() => tx.marketMakingConfig.deleteMany({ where: { botId: { in: botIds } } }));
        await deps.ignoreMissingTable(() => tx.volumeConfig.deleteMany({ where: { botId: { in: botIds } } }));
        await deps.ignoreMissingTable(() => tx.riskConfig.deleteMany({ where: { botId: { in: botIds } } }));
        await deps.ignoreMissingTable(() => tx.botNotificationConfig.deleteMany({ where: { botId: { in: botIds } } }));
        await deps.ignoreMissingTable(() => tx.botPriceSupportConfig.deleteMany({ where: { botId: { in: botIds } } }));
        await deps.ignoreMissingTable(() => tx.botFillCursor.deleteMany({ where: { botId: { in: botIds } } }));
        await deps.ignoreMissingTable(() => tx.botFillSeen.deleteMany({ where: { botId: { in: botIds } } }));
        await deps.ignoreMissingTable(() => tx.botOrderMap.deleteMany({ where: { botId: { in: botIds } } }));
        await deps.ignoreMissingTable(() => tx.manualTradeLog.deleteMany({ where: { botId: { in: botIds } } }));
        await deps.ignoreMissingTable(() => tx.bot.deleteMany({ where: { id: { in: botIds } } }));
      }

      await deps.ignoreMissingTable(() => tx.prediction.deleteMany({ where: { userId: user.id } }));
      await deps.ignoreMissingTable(() => tx.predictionState.deleteMany({ where: { userId: user.id } }));
      await deps.ignoreMissingTable(() => tx.manualTradeLog.deleteMany({ where: { userId: user.id } }));
      await deps.ignoreMissingTable(() => tx.exchangeAccount.deleteMany({ where: { userId: user.id } }));
      await deps.ignoreMissingTable(() => tx.botConfigPreset.deleteMany({ where: { createdByUserId: user.id } }));
      await deps.ignoreMissingTable(() => tx.auditEvent.deleteMany({ where: { actorUserId: user.id } }));
      await deps.ignoreMissingTable(() => tx.workspaceMember.deleteMany({ where: { userId: user.id } }));
      await deps.ignoreMissingTable(() => tx.reauthOtp.deleteMany({ where: { userId: user.id } }));
      await deps.ignoreMissingTable(() => tx.reauthSession.deleteMany({ where: { userId: user.id } }));
      await deps.ignoreMissingTable(() => tx.session.deleteMany({ where: { userId: user.id } }));
      await deps.ignoreMissingTable(() => tx.user.delete({ where: { id: user.id } }));
    });

    const backendAccessSettings = deps.parseStoredAdminBackendAccess(
      await deps.getGlobalSettingValue(deps.GLOBAL_SETTING_ADMIN_BACKEND_ACCESS_KEY)
    );
    if (backendAccessSettings.userIds.includes(user.id)) {
      await deps.setGlobalSettingValue(deps.GLOBAL_SETTING_ADMIN_BACKEND_ACCESS_KEY, {
        userIds: backendAccessSettings.userIds.filter((entry) => entry !== user.id)
      });
    }
    await deps.recordAdminAuditEvent({
      actorUserId: actor.id,
      action: "admin.user.deleted",
      targetType: "user",
      targetId: user.id,
      targetLabel: user.email,
      ip: req.ip ?? null
    });

    return res.json({ ok: true, deletedUserId: user.id });
  });

  app.get("/admin/settings/telegram", requireAuth, async (_req, res) => {
    if (!(await deps.requireSuperadmin(res))) return;
    const config = await deps.db.alertConfig.findUnique({
      where: { key: "default" },
      select: {
        telegramBotToken: true,
        telegramChatId: true
      }
    });
    const envToken = deps.parseTelegramConfigValue(process.env.TELEGRAM_BOT_TOKEN);
    const envChatId = deps.normalizeTelegramChatId(process.env.TELEGRAM_CHAT_ID);

    return res.json({
      telegramBotTokenMasked: config?.telegramBotToken ? deps.maskSecret(config.telegramBotToken) : null,
      telegramChatId: config?.telegramChatId ?? null,
      configured: Boolean(config?.telegramBotToken && config?.telegramChatId),
      envOverride: Boolean(envToken && envChatId)
    });
  });

  app.put("/admin/settings/telegram", requireAuth, async (req, res) => {
    if (!(await deps.requireSuperadmin(res))) return;
    const parsed = adminTelegramSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return res.status(400).json({ error: "invalid_payload", details: parsed.error.flatten() });
    }

    const token = deps.parseTelegramConfigValue(parsed.data.telegramBotToken);
    const chatId = deps.normalizeTelegramChatId(parsed.data.telegramChatId);
    const chatIdConflict = await deps.findTelegramChatIdConflict({
      chatId,
      currentUserId: null,
      includeGlobal: false
    });
    if (chatIdConflict) {
      return deps.buildTelegramChatIdConflictResponse(res);
    }

    const updated = await deps.db.alertConfig.upsert({
      where: { key: "default" },
      create: {
        key: "default",
        telegramBotToken: token,
        telegramChatId: chatId
      },
      update: {
        telegramBotToken: token,
        telegramChatId: chatId
      },
      select: {
        telegramBotToken: true,
        telegramChatId: true
      }
    });

    return res.json({
      telegramBotTokenMasked: updated.telegramBotToken ? deps.maskSecret(updated.telegramBotToken) : null,
      telegramChatId: updated.telegramChatId ?? null,
      configured: Boolean(updated.telegramBotToken && updated.telegramChatId)
    });
  });

  app.post("/admin/settings/telegram/test", requireAuth, async (_req, res) => {
    if (!(await deps.requireSuperadmin(res))) return;
    const user = getUserFromLocals(res);
    const config = await deps.resolveTelegramConfig();
    if (!config) {
      return res.status(400).json({
        error: "telegram_not_configured",
        details: "No Telegram config found in ENV or DB."
      });
    }
    try {
      await deps.sendTelegramMessage({
        ...config,
        text: [
          "uLiquid Desk admin telegram test",
          `Triggered by: ${user.email}`,
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

  app.get("/admin/settings/exchanges", requireAuth, async (_req, res) => {
    if (!(await deps.requireSuperadmin(res))) return;
    const allowed = await deps.getAllowedExchangeValues();
    return res.json({
      allowed,
      options: deps.getExchangeOptionsResponse(allowed)
    });
  });

  app.get("/admin/venue-health/summary", requireAuth, async (_req, res) => {
    if (!(await deps.requireSuperadmin(res))) return;

    const [allowed, accountRows] = await Promise.all([
      deps.getAllowedExchangeValues(),
      deps.db.exchangeAccount.findMany({
        select: {
          id: true,
          exchange: true,
          label: true,
          updatedAt: true,
          lastUsedAt: true,
          lastSyncErrorAt: true,
          lastSyncErrorMessage: true
        }
      }).catch(() => [])
    ]);

    const normalizedAllowed = new Set(
      allowed.map((value) => deps.normalizeExchangeValue(String(value ?? ""))).filter(Boolean)
    );
    const runtimeEnabled = deps.getRuntimeEnabledExchangeValues();
    const optionLabels = new Map<string, string>(
      (deps.getExchangeOptionsResponse(Array.from(normalizedAllowed))?.options ?? [])
        .map((option: any) => [
          deps.normalizeExchangeValue(String(option?.value ?? "")),
          String(option?.label ?? option?.value ?? "").trim()
        ])
        .filter((entry: [string, string]) => Boolean(entry[0]))
    );

    const venues = Array.from(new Set([
      ...Array.from(deps.EXCHANGE_OPTION_VALUES).map((value) => deps.normalizeExchangeValue(value)),
      ...Array.from(normalizedAllowed),
      ...Array.from(runtimeEnabled),
      ...accountRows.map((row: any) => deps.normalizeExchangeValue(String(row?.exchange ?? ""))).filter(Boolean)
    ])).sort();

    const counts = {
      clean: 0,
      warning: 0,
      blocked: 0,
      unknown: 0
    };

    const items = venues.map((venue) => {
      const accounts = accountRows.filter(
        (row: any) => deps.normalizeExchangeValue(String(row?.exchange ?? "")) === venue
      );
      const capability = getFuturesVenueCapabilities(venue);
      const syncErrors = accounts
        .filter((row: any) => row?.lastSyncErrorAt || row?.lastSyncErrorMessage)
        .sort((left: any, right: any) => {
          const leftTs = left?.lastSyncErrorAt instanceof Date ? left.lastSyncErrorAt.getTime() : 0;
          const rightTs = right?.lastSyncErrorAt instanceof Date ? right.lastSyncErrorAt.getTime() : 0;
          return rightTs - leftTs;
        });
      const activeAccounts = accounts.filter((row: any) => row?.lastUsedAt instanceof Date);

      const health: "clean" | "warning" | "blocked" | "unknown" = accounts.length === 0
        ? "unknown"
        : syncErrors.length > 0
          ? "blocked"
          : activeAccounts.length === 0
            ? "warning"
            : "clean";

      counts[health] += 1;

      return {
        venue,
        label: optionLabels.get(venue) ?? venue,
        health,
        allowed: normalizedAllowed.has(venue),
        runtimeEnabled: runtimeEnabled.has(venue),
        connectorKind: capability.connectorKind,
        accountCount: accounts.length,
        activeAccountCount: activeAccounts.length,
        syncErrorCount: syncErrors.length,
        lastUsedAt: activeAccounts
          .map((row: any) => row.lastUsedAt)
          .filter((value: unknown): value is Date => value instanceof Date)
          .sort((left, right) => right.getTime() - left.getTime())[0]?.toISOString() ?? null,
        latestSyncErrorAt: syncErrors[0]?.lastSyncErrorAt instanceof Date
          ? syncErrors[0].lastSyncErrorAt.toISOString()
          : null,
        latestSyncErrorMessage: syncErrors[0]?.lastSyncErrorMessage
          ? String(syncErrors[0].lastSyncErrorMessage)
          : null,
        sampleAccounts: accounts.slice(0, 3).map((row: any) => ({
          id: String(row.id),
          label: String(row.label ?? row.id),
          updatedAt: row.updatedAt instanceof Date ? row.updatedAt.toISOString() : null,
          lastUsedAt: row.lastUsedAt instanceof Date ? row.lastUsedAt.toISOString() : null,
          lastSyncErrorAt: row.lastSyncErrorAt instanceof Date ? row.lastSyncErrorAt.toISOString() : null,
          lastSyncErrorMessage: row.lastSyncErrorMessage ? String(row.lastSyncErrorMessage) : null
        })),
        capabilities: {
          supportsPerpExecution: capability.supportsPerpExecution,
          supportsPositionReads: capability.supportsPositionReads,
          supportsBalanceReads: capability.supportsBalanceReads,
          supportsOrderEditing: capability.supportsOrderEditing,
          supportsPositionTpSl: capability.supportsPositionTpSl,
          supportsPositionClose: capability.supportsPositionClose,
          supportsGridExecution: capability.supportsGridExecution,
          supportsVaultExecution: capability.supportsVaultExecution,
          supportsTransfers: capability.supportsTransfers
        }
      };
    });

    return res.json({
      updatedAt: new Date().toISOString(),
      counts,
      allowedExchanges: Array.from(normalizedAllowed),
      runtimeEnabledExchanges: Array.from(runtimeEnabled),
      items
    });
  });

  app.put("/admin/settings/exchanges", requireAuth, async (req, res) => {
    if (!(await deps.requireSuperadmin(res))) return;
    const parsed = adminExchangesSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return res.status(400).json({ error: "invalid_payload", details: parsed.error.flatten() });
    }

    const normalized = Array.from(
      new Set(
        parsed.data.allowed
          .map(deps.normalizeExchangeValue)
          .filter((value) => deps.EXCHANGE_OPTION_VALUES.has(value))
          .filter((value) => deps.getRuntimeEnabledExchangeValues().has(value))
      )
    );

    if (normalized.length === 0) {
      return res.status(400).json({ error: "allowed_exchanges_empty" });
    }

    await deps.setGlobalSettingValue(deps.GLOBAL_SETTING_EXCHANGES_KEY, normalized);
    return res.json({
      allowed: normalized,
      options: deps.getExchangeOptionsResponse(normalized)
    });
  });

  app.get("/admin/settings/smtp", requireAuth, async (_req, res) => {
    if (!(await deps.requireSuperadmin(res))) return;
    const row = await deps.db.globalSetting.findUnique({
      where: { key: deps.GLOBAL_SETTING_SMTP_KEY },
      select: {
        value: true,
        updatedAt: true
      }
    });
    const settings = deps.parseStoredSmtpSettings(row?.value);
    const envConfigured = Boolean(
      process.env.SMTP_HOST &&
        process.env.SMTP_PORT &&
        process.env.SMTP_USER &&
        process.env.SMTP_PASS &&
        process.env.SMTP_FROM
    );

    return res.json({
      ...deps.toPublicSmtpSettings(settings),
      updatedAt: row?.updatedAt ?? null,
      envOverride: envConfigured
    });
  });

  app.put("/admin/settings/smtp", requireAuth, async (req, res) => {
    if (!(await deps.requireSuperadmin(res))) return;
    const parsed = adminSmtpSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return res.status(400).json({ error: "invalid_payload", details: parsed.error.flatten() });
    }

    const existing = deps.parseStoredSmtpSettings(await deps.getGlobalSettingValue(deps.GLOBAL_SETTING_SMTP_KEY));
    const nextValue = {
      host: parsed.data.host.trim(),
      port: parsed.data.port,
      user: parsed.data.user.trim(),
      from: parsed.data.from.trim(),
      secure: parsed.data.secure,
      passEnc: parsed.data.password
        ? deps.encryptSecret(parsed.data.password)
        : existing.passEnc
    };

    if (!nextValue.passEnc) {
      return res.status(400).json({ error: "smtp_password_required" });
    }

    const updated = await deps.setGlobalSettingValue(deps.GLOBAL_SETTING_SMTP_KEY, nextValue);
    const settings = deps.parseStoredSmtpSettings(updated.value);

    return res.json({
      ...deps.toPublicSmtpSettings(settings),
      updatedAt: updated.updatedAt
    });
  });

  app.post("/admin/settings/smtp/test", requireAuth, async (req, res) => {
    if (!(await deps.requireSuperadmin(res))) return;
    const parsed = adminSmtpTestSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return res.status(400).json({ error: "invalid_payload", details: parsed.error.flatten() });
    }

    const sent = await deps.sendSmtpTestEmail({
      to: parsed.data.to,
      subject: "uLiquid Desk SMTP Test",
      text: [
        "uLiquid Desk SMTP test successful.",
        `Time: ${new Date().toISOString()}`
      ].join("\n")
    });
    if (!sent.ok) {
      return res.status(502).json({
        error: sent.error ?? "smtp_test_failed"
      });
    }

    return res.json({ ok: true });
  });
}
