import crypto from "node:crypto";
import type express from "express";
import type { Express } from "express";
import { z } from "zod";
import { getUserFromLocals, requireAuth } from "../auth.js";
import {
  DEFAULT_NOTIFICATION_PLUGIN_IDS,
  getNotificationPluginSettingsForUser as defaultGetNotificationPluginSettingsForUser,
  updateNotificationPluginSettingsForUser as defaultUpdateNotificationPluginSettingsForUser
} from "../plugins/notificationSettings.js";
import {
  APNS_NOTIFICATION_PLUGIN_ID,
  isApnsConfigured
} from "../plugins/notifications/apnsNotificationPlugin.js";

type RegisterMobilePushRoutesDeps = {
  db: any;
  authMiddleware?: express.RequestHandler;
  getNotificationPluginSettingsForUser?: typeof defaultGetNotificationPluginSettingsForUser;
  updateNotificationPluginSettingsForUser?: typeof defaultUpdateNotificationPluginSettingsForUser;
};

const pushEnvironmentSchema = z.enum(["sandbox", "production"]);

const registerPushTokenSchema = z.object({
  token: z.string().trim().min(32).max(4096),
  environment: pushEnvironmentSchema.optional(),
  bundleId: z.string().trim().min(1).max(160),
  deviceId: z.string().trim().max(160).nullable().optional(),
  appVersion: z.string().trim().max(80).nullable().optional(),
  platform: z.literal("ios").default("ios")
});

const unregisterPushTokenSchema = z.object({
  token: z.string().trim().min(1).max(4096).optional(),
  deviceId: z.string().trim().max(160).nullable().optional()
});

function normalizePushEnvironment(value: unknown): "sandbox" | "production" {
  return String(value ?? process.env.APNS_ENV ?? "").trim().toLowerCase() === "sandbox"
    ? "sandbox"
    : "production";
}

function normalizeDeviceToken(value: string): string {
  return value
    .replace(/[<>\s]/g, "")
    .trim()
    .toLowerCase();
}

function tokenHash(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function isValidDeviceToken(token: string): boolean {
  return /^[0-9a-f]{32,4096}$/.test(token);
}

function uniqueList(values: string[]): string[] {
  const out: string[] = [];
  for (const value of values) {
    const normalized = String(value ?? "").trim();
    if (!normalized || out.includes(normalized)) continue;
    out.push(normalized);
  }
  return out;
}

async function enableApnsNotificationsForUser(deps: RegisterMobilePushRoutesDeps, userId: string) {
  const getSettings = deps.getNotificationPluginSettingsForUser ?? defaultGetNotificationPluginSettingsForUser;
  const updateSettings = deps.updateNotificationPluginSettingsForUser ?? defaultUpdateNotificationPluginSettingsForUser;
  const current = await getSettings(userId);
  const disabled = current.disabled.filter((pluginId) => pluginId !== APNS_NOTIFICATION_PLUGIN_ID);
  const enabled = uniqueList([
    ...DEFAULT_NOTIFICATION_PLUGIN_IDS,
    ...current.enabled,
    APNS_NOTIFICATION_PLUGIN_ID
  ]).filter((pluginId) => !disabled.includes(pluginId));
  const order = uniqueList([
    ...current.order,
    APNS_NOTIFICATION_PLUGIN_ID
  ]).filter((pluginId) => enabled.includes(pluginId));

  await updateSettings({
    userId,
    patch: {
      enabled,
      disabled,
      order
    }
  });
}

function toTokenDto(row: any) {
  return {
    id: String(row.id),
    platform: String(row.platform ?? "ios"),
    environment: String(row.environment ?? "production"),
    bundleId: String(row.bundleId ?? ""),
    deviceId: row.deviceId ?? null,
    appVersion: row.appVersion ?? null,
    enabled: Boolean(row.enabled),
    lastSeenAt: row.lastSeenAt instanceof Date ? row.lastSeenAt.toISOString() : row.lastSeenAt ?? null,
    revokedAt: row.revokedAt instanceof Date ? row.revokedAt.toISOString() : row.revokedAt ?? null,
    createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : row.createdAt ?? null
  };
}

export function registerMobilePushRoutes(app: Express, deps: RegisterMobilePushRoutesDeps) {
  const auth = deps.authMiddleware ?? requireAuth;

  app.get("/mobile/push-status", auth, async (_req, res) => {
    const user = getUserFromLocals(res);
    const tokens = await deps.db.mobilePushToken.findMany({
      where: { userId: user.id },
      orderBy: { lastSeenAt: "desc" },
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

    return res.json({
      enabled: tokens.some((token: any) => token.enabled && !token.revokedAt),
      apnsConfigured: isApnsConfigured(),
      environment: normalizePushEnvironment(null),
      bundleId: process.env.APNS_BUNDLE_ID ?? null,
      tokens: tokens.map(toTokenDto)
    });
  });

  app.post("/mobile/push-tokens", auth, async (req, res) => {
    const parsed = registerPushTokenSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return res.status(400).json({ error: "invalid_payload", details: parsed.error.flatten() });
    }

    const normalizedToken = normalizeDeviceToken(parsed.data.token);
    if (!isValidDeviceToken(normalizedToken)) {
      return res.status(400).json({ error: "invalid_device_token" });
    }

    const user = getUserFromLocals(res);
    const now = new Date();
    const environment = normalizePushEnvironment(parsed.data.environment);
    const hash = tokenHash(normalizedToken);
    const existing = await deps.db.mobilePushToken.findUnique({
      where: { tokenHash: hash },
      select: { id: true }
    });
    const data = {
      userId: user.id,
      token: normalizedToken,
      tokenHash: hash,
      platform: parsed.data.platform,
      environment,
      bundleId: parsed.data.bundleId,
      deviceId: parsed.data.deviceId ?? null,
      appVersion: parsed.data.appVersion ?? null,
      enabled: true,
      revokedAt: null,
      lastSeenAt: now
    };

    const saved = existing
      ? await deps.db.mobilePushToken.update({
          where: { id: existing.id },
          data,
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
        })
      : await deps.db.mobilePushToken.create({
          data,
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

    await enableApnsNotificationsForUser(deps, user.id);

    return res.status(existing ? 200 : 201).json({
      token: toTokenDto(saved),
      apnsConfigured: isApnsConfigured()
    });
  });

  app.post("/mobile/push-tokens/unregister", auth, async (req, res) => {
    const parsed = unregisterPushTokenSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return res.status(400).json({ error: "invalid_payload", details: parsed.error.flatten() });
    }

    const user = getUserFromLocals(res);
    const where: Record<string, unknown> = { userId: user.id, revokedAt: null };
    if (parsed.data.token) {
      where.tokenHash = tokenHash(normalizeDeviceToken(parsed.data.token));
    } else if (parsed.data.deviceId) {
      where.deviceId = parsed.data.deviceId;
    }

    const result = await deps.db.mobilePushToken.updateMany({
      where,
      data: {
        enabled: false,
        revokedAt: new Date()
      }
    });

    return res.json({
      revoked: Number(result.count ?? 0)
    });
  });
}
