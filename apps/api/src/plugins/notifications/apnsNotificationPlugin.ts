import crypto from "node:crypto";
import http2 from "node:http2";
import { prisma } from "@mm/db";
import type { ApiNotificationEvent, ApiNotificationPlugin } from "./types.js";

export const APNS_NOTIFICATION_PLUGIN_ID = "core.notification.apns";

type ApnsEnvironment = "sandbox" | "production";

type ApnsConfig = {
  teamId: string;
  keyId: string;
  privateKey: string;
  bundleId: string;
  environment: ApnsEnvironment;
};

type ApnsSendResult = {
  ok: boolean;
  status: number;
  reason: string | null;
  retryable: boolean;
  invalidToken: boolean;
};

const db = prisma as any;
const TOKEN_TTL_MS = 50 * 60 * 1000;
let cachedProviderToken: { key: string; expiresAt: number; value: string } | null = null;

function normalizeEnv(value: unknown): ApnsEnvironment {
  return String(value ?? "").trim().toLowerCase() === "sandbox" ? "sandbox" : "production";
}

function readEnvString(name: string): string | null {
  const value = String(process.env[name] ?? "").trim();
  return value || null;
}

function readPrivateKey(): string | null {
  const raw = readEnvString("APNS_PRIVATE_KEY");
  if (!raw) return null;
  return raw.includes("\\n") ? raw.replace(/\\n/g, "\n") : raw;
}

export function resolveApnsConfig(): ApnsConfig | null {
  const teamId = readEnvString("APNS_TEAM_ID");
  const keyId = readEnvString("APNS_KEY_ID");
  const privateKey = readPrivateKey();
  const bundleId = readEnvString("APNS_BUNDLE_ID");
  if (!teamId || !keyId || !privateKey || !bundleId) return null;
  return {
    teamId,
    keyId,
    privateKey,
    bundleId,
    environment: normalizeEnv(process.env.APNS_ENV)
  };
}

export function isApnsConfigured(): boolean {
  return resolveApnsConfig() !== null;
}

function base64Url(input: Buffer | string): string {
  return Buffer.from(input)
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function createProviderToken(config: ApnsConfig, nowMs = Date.now()): string {
  const cacheKey = `${config.teamId}:${config.keyId}:${crypto.createHash("sha256").update(config.privateKey).digest("hex")}`;
  if (cachedProviderToken && cachedProviderToken.key === cacheKey && cachedProviderToken.expiresAt > nowMs) {
    return cachedProviderToken.value;
  }

  const header = base64Url(JSON.stringify({ alg: "ES256", kid: config.keyId }));
  const claims = base64Url(JSON.stringify({ iss: config.teamId, iat: Math.floor(nowMs / 1000) }));
  const signingInput = `${header}.${claims}`;
  const key = crypto.createPrivateKey(config.privateKey);
  const signature = crypto.sign("sha256", Buffer.from(signingInput), {
    key,
    dsaEncoding: "ieee-p1363"
  });
  const value = `${signingInput}.${base64Url(signature)}`;
  cachedProviderToken = {
    key: cacheKey,
    value,
    expiresAt: nowMs + TOKEN_TTL_MS
  };
  return value;
}

function apnsHost(environment: ApnsEnvironment): string {
  return environment === "sandbox"
    ? "https://api.sandbox.push.apple.com"
    : "https://api.push.apple.com";
}

function notificationTitle(event: ApiNotificationEvent): string {
  if (event.type === "prediction.tradable") return "uLiquid Signal";
  if (isMobileMonitoringEvent(event)) return event.payload.title || "uLiquid Monitoring";
  return "uLiquid AI Prediction";
}

function notificationBody(event: ApiNotificationEvent): string {
  if (isMobileMonitoringEvent(event)) {
    return event.payload.message || "Neue uLiquid Monitoring-Meldung";
  }
  if (event.type !== "prediction.tradable" && event.type !== "prediction.market_analysis_update") {
    return "Neue uLiquid Benachrichtigung";
  }
  const signal = String(event.payload.signal ?? "neutral").toUpperCase();
  const move = Number(event.payload.expectedMovePct);
  const moveText = Number.isFinite(move) ? ` ${move >= 0 ? "+" : ""}${move.toFixed(2)}%` : "";
  return `${event.payload.symbol} ${event.payload.timeframe} ${signal}${moveText}`;
}

function isMobileMonitoringEvent(event: ApiNotificationEvent): event is Extract<ApiNotificationEvent, {
  type: "bot.error" | "account.margin_warning" | "position.opened" | "position.pnl_move" | "calendar.high_impact";
}> {
  return event.type === "bot.error"
    || event.type === "account.margin_warning"
    || event.type === "position.opened"
    || event.type === "position.pnl_move"
    || event.type === "calendar.high_impact";
}

function buildApnsPayload(event: ApiNotificationEvent) {
  return {
    aps: {
      alert: {
        title: notificationTitle(event),
        body: notificationBody(event)
      },
      sound: "default"
    },
    type: event.type,
    predictionId:
      event.type === "prediction.tradable" || event.type === "prediction.market_analysis_update"
        ? event.payload.predictionId
        : null,
    symbol:
      event.type === "prediction.tradable" || event.type === "prediction.market_analysis_update"
        ? event.payload.symbol
        : null,
    timeframe:
      event.type === "prediction.tradable" || event.type === "prediction.market_analysis_update"
        ? event.payload.timeframe
        : null,
    routeTab: isMobileMonitoringEvent(event) ? event.payload.routeTab ?? null : null,
    routeId: isMobileMonitoringEvent(event) ? event.payload.routeId ?? null : null
  };
}

async function sendApnsAlert(params: {
  config: ApnsConfig;
  token: string;
  payload: unknown;
  collapseId: string;
}): Promise<ApnsSendResult> {
  if (String(process.env.APNS_DRY_RUN ?? "").trim() === "1") {
    return {
      ok: true,
      status: 200,
      reason: "dry_run",
      retryable: false,
      invalidToken: false
    };
  }

  const providerToken = createProviderToken(params.config);
  const requestPayload = JSON.stringify(params.payload);
  const path = `/3/device/${params.token}`;

  return new Promise((resolve) => {
    const client = http2.connect(apnsHost(params.config.environment));
    let settled = false;
    let status = 0;
    let responseText = "";

    const finish = (result: ApnsSendResult) => {
      if (settled) return;
      settled = true;
      client.close();
      resolve(result);
    };

    client.setTimeout(5_000, () => {
      finish({
        ok: false,
        status: 0,
        reason: "apns_timeout",
        retryable: true,
        invalidToken: false
      });
    });

    client.on("error", (error) => {
      finish({
        ok: false,
        status: 0,
        reason: error.message,
        retryable: true,
        invalidToken: false
      });
    });

    const request = client.request({
      ":method": "POST",
      ":path": path,
      "authorization": `bearer ${providerToken}`,
      "apns-topic": params.config.bundleId,
      "apns-push-type": "alert",
      "apns-priority": "10",
      "apns-collapse-id": params.collapseId.slice(0, 64),
      "content-type": "application/json",
      "content-length": Buffer.byteLength(requestPayload)
    });

    request.setEncoding("utf8");
    request.on("response", (headers) => {
      status = Number(headers[":status"] ?? 0);
    });
    request.on("data", (chunk) => {
      responseText += String(chunk);
    });
    request.on("end", () => {
      let reason: string | null = null;
      try {
        const parsed = responseText ? JSON.parse(responseText) : null;
        reason = typeof parsed?.reason === "string" ? parsed.reason : null;
      } catch {
        reason = responseText || null;
      }
      const invalidToken = status === 400 || status === 410;
      finish({
        ok: status >= 200 && status < 300,
        status,
        reason,
        retryable: status === 429 || status >= 500 || status === 0,
        invalidToken
      });
    });
    request.on("error", (error) => {
      finish({
        ok: false,
        status,
        reason: error.message,
        retryable: true,
        invalidToken: false
      });
    });
    request.end(requestPayload);
  });
}

export const apnsNotificationPlugin: ApiNotificationPlugin = {
  manifest: {
    id: APNS_NOTIFICATION_PLUGIN_ID,
    kind: "notification",
    version: "1.0.0",
    description: "Built-in Apple Push Notification service channel",
    minPlan: "free",
    defaultEnabled: true,
    capabilities: ["notification.apns"]
  },
  canHandle(event): boolean {
    return event.type === "prediction.tradable"
      || event.type === "prediction.market_analysis_update"
      || isMobileMonitoringEvent(event);
  },
  async send(event, ctx) {
    if (
      event.type !== "prediction.tradable"
      && event.type !== "prediction.market_analysis_update"
      && !isMobileMonitoringEvent(event)
    ) {
      return {
        status: "skipped",
        providerId: APNS_NOTIFICATION_PLUGIN_ID,
        reason: "event_not_supported",
        retryable: false,
        latencyMs: 0
      };
    }

    const config = resolveApnsConfig();
    if (!config) {
      return {
        status: "skipped",
        providerId: APNS_NOTIFICATION_PLUGIN_ID,
        reason: "apns_not_configured",
        retryable: false,
        latencyMs: 0
      };
    }

    const tokens = await db.mobilePushToken.findMany({
      where: {
        userId: ctx.userId,
        enabled: true,
        revokedAt: null,
        environment: config.environment,
        bundleId: config.bundleId
      },
      select: {
        id: true,
        token: true
      }
    });

    if (!Array.isArray(tokens) || tokens.length === 0) {
      return {
        status: "skipped",
        providerId: APNS_NOTIFICATION_PLUGIN_ID,
        reason: "no_active_mobile_push_tokens",
        retryable: false,
        latencyMs: 0
      };
    }

    const startedAt = Date.now();
    const payload = buildApnsPayload(event);
    let sent = 0;
    let failed = 0;
    let retryable = false;
    const revokedTokenIds: string[] = [];

    for (const token of tokens) {
      const result = await sendApnsAlert({
        config,
        token: String(token.token),
        payload,
        collapseId: String(event.eventId ?? event.type)
      });
      if (result.ok) {
        sent += 1;
        continue;
      }
      failed += 1;
      retryable = retryable || result.retryable;
      if (result.invalidToken) {
        revokedTokenIds.push(String(token.id));
      }
    }

    if (revokedTokenIds.length > 0) {
      await db.mobilePushToken.updateMany({
        where: { id: { in: revokedTokenIds } },
        data: { enabled: false, revokedAt: new Date() }
      });
    }

    return {
      status: sent > 0 ? "sent" : "failed",
      providerId: APNS_NOTIFICATION_PLUGIN_ID,
      reason: sent > 0 ? "apns_dispatched" : "apns_send_failed",
      retryable: sent === 0 ? retryable : false,
      latencyMs: Date.now() - startedAt,
      metadata: {
        sent,
        failed,
        revoked: revokedTokenIds.length
      }
    };
  }
};
