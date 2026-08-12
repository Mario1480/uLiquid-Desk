import assert from "node:assert/strict";
import test from "node:test";
import { registerSettingsCoreRoutes } from "./routes-core.js";
import { createTelegramTestDb } from "../telegram/testDb.js";

type RouteMap = Map<string, Array<(...args: any[]) => any>>;

function createFakeApp() {
  const getRoutes: RouteMap = new Map();
  const postRoutes: RouteMap = new Map();
  const putRoutes: RouteMap = new Map();
  const deleteRoutes: RouteMap = new Map();
  return {
    get(path: string, ...handlers: Array<(...args: any[]) => any>) {
      getRoutes.set(path, handlers);
    },
    post(path: string, ...handlers: Array<(...args: any[]) => any>) {
      postRoutes.set(path, handlers);
    },
    put(path: string, ...handlers: Array<(...args: any[]) => any>) {
      putRoutes.set(path, handlers);
    },
    delete(path: string, ...handlers: Array<(...args: any[]) => any>) {
      deleteRoutes.set(path, handlers);
    },
    routes: {
      get: getRoutes,
      post: postRoutes,
      put: putRoutes,
      delete: deleteRoutes
    }
  };
}

function createMockRes() {
  return {
    locals: {
      user: {
        id: "user_1",
        email: "user_1@example.com"
      }
    },
    statusCode: 200,
    body: null as any,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: any) {
      this.body = payload;
      return this;
    }
  };
}

function getFinalHandler(app: ReturnType<typeof createFakeApp>, method: "get" | "post" | "put" | "delete", path: string) {
  const handlers = app.routes[method].get(path);
  if (!handlers?.length) throw new Error(`route_not_found:${method}:${path}`);
  return handlers[handlers.length - 1];
}

function createDeps(db: any, sentMessages: string[] = []) {
  return {
    db,
    isSuperadminEmail: () => false,
    resolveUserContext: async () => ({ isSuperadmin: false }),
    getSecurityGlobalSettings: async () => ({ reauthOtpEnabled: true }),
    setSecurityGlobalSettings: async () => undefined,
    getSecurityUserReauthOverride: async () => null,
    setSecurityUserReauthOverride: async () => undefined,
    getAllowedExchangeValues: async () => ["bitget", "paper"],
    getExchangeOptionsResponse: () => ({ items: [] }),
    getServerInfoSettings: async () => ({ serverIpAddress: null }),
    getDailyEconomicCalendarSettingsForUser: async () => ({
      enabled: false,
      currencies: ["USD"],
      impacts: ["high"],
      sendTimeLocal: "08:00",
      timezoneMode: "device",
      timezone: "UTC"
    }),
    updateDailyEconomicCalendarSettingsForUser: async ({ patch }: any) => ({
      enabled: Boolean(patch.enabled),
      currencies: patch.currencies ?? ["USD"],
      impacts: patch.impacts ?? ["high"],
      sendTimeLocal: patch.sendTimeLocal ?? "08:00",
      timezoneMode: patch.timezoneMode ?? "device",
      timezone: patch.timezone ?? "UTC"
    }),
    getNotificationPluginSettingsForUser: async () => ({ enabled: ["core.notification.telegram"], disabled: [], order: ["core.notification.telegram"] }),
    updateNotificationPluginSettingsForUser: async ({ patch }: any) => patch,
    getNotificationDestinationsSettingsForUser: async () => ({ webhook: { url: null, headers: {} } }),
    updateNotificationDestinationsSettingsForUser: async ({ patch }: any) => patch,
    toNotificationDestinationsSettingsResponse: (value: any) => value,
    toDailyEconomicCalendarSettingsResponse: (value: any) => value,
    requireSuperadmin: async () => false,
    GLOBAL_SETTING_ACCESS_SECTION_KEY: "access",
    GLOBAL_SETTING_SERVER_INFO_KEY: "server",
    parseStoredAccessSectionSettings: (value: unknown) => value,
    toEffectiveAccessSectionSettings: (value: unknown) => value ?? { visibility: {}, maintenance: { enabled: false } },
    DEFAULT_ACCESS_SECTION_SETTINGS: { visibility: {}, maintenance: { enabled: false } },
    setGlobalSettingValue: async (_key: string, value: unknown) => ({ value, updatedAt: new Date() }),
    normalizeServerIpAddress: () => null,
    getAccessSectionSettings: async () => ({ visibility: {}, maintenance: { enabled: false } }),
    getAccessSectionUsageForUser: async () => ({}),
    evaluateAccessSectionBypassForUser: async () => false,
    computeRemaining: (limit: number | null, usage: number) => (limit === null ? null : Math.max(limit - usage, 0)),
    resolveTelegramConfig: async (userId?: string | null) => {
      const user = db.state.users.find((entry: any) => entry.id === userId) ?? null;
      return user?.telegramChatId
        ? { botToken: "bot-token", chatId: user.telegramChatId }
        : null;
    },
    sendTelegramMessage: async ({ text }: any) => {
      sentMessages.push(String(text));
    }
  } as any;
}

test("start-link and status endpoints expose pending Telegram link session", async () => {
  const app = createFakeApp();
  const db = createTelegramTestDb({
    users: [{ id: "user_1", telegramChatId: null }]
  });

  process.env.TELEGRAM_BOT_TOKEN = "bot-token";
  process.env.NEXT_PUBLIC_TELEGRAM_BOT_USERNAME = "uliquid_desk_bot";

  registerSettingsCoreRoutes(app as any, createDeps(db));

  const postHandler = getFinalHandler(app, "post", "/settings/alerts/telegram/link");
  const getHandler = getFinalHandler(app, "get", "/settings/alerts/telegram/link");

  const postRes = createMockRes();
  await postHandler({}, postRes);
  assert.equal(postRes.statusCode, 200);
  assert.equal(postRes.body?.status, "pending");
  assert.match(String(postRes.body?.connectUrl), /^https:\/\/t\.me\/uliquid_desk_bot\?start=link_/);

  const getRes = createMockRes();
  await getHandler({}, getRes);
  assert.equal(getRes.statusCode, 200);
  assert.equal(getRes.body?.status, "pending");
});

test("send-now endpoint delivers the calendar and records delivery metadata", async () => {
  const app = createFakeApp();
  const db = createTelegramTestDb({
    users: [{ id: "user_1", telegramChatId: "-100123" }]
  });
  let savedPatch: Record<string, unknown> | null = null;
  const deps = createDeps(db) as any;
  deps.getDailyEconomicCalendarSettingsForUser = async () => ({
    enabled: true,
    currencies: ["USD"],
    impacts: ["high"],
    sendTimeLocal: "08:00",
    timezoneMode: "manual",
    timezone: "Europe/Berlin",
    lastSentLocalDate: null,
    lastSentAt: null
  });
  deps.updateDailyEconomicCalendarSettingsForUser = async ({ patch }: any) => {
    savedPatch = patch;
    return {
      ...(await deps.getDailyEconomicCalendarSettingsForUser()),
      ...patch
    };
  };
  deps.sendDailyEconomicCalendarDigestForUser = async () => ({
    sent: true,
    eventCount: 3,
    localDate: "2026-08-12"
  });
  registerSettingsCoreRoutes(app as any, deps);

  const handler = getFinalHandler(app, "post", "/settings/alerts/economic-calendar/send-now");
  const res = createMockRes();
  await handler({}, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body?.eventCount, 3);
  assert.equal(savedPatch?.lastSentLocalDate, "2026-08-12");
  assert.equal(typeof savedPatch?.lastSentAt, "string");
});

test("disconnect route clears connected Telegram chat and pending sessions", async () => {
  const app = createFakeApp();
  const db = createTelegramTestDb({
    users: [{ id: "user_1", telegramChatId: "123456789" }],
    sessions: [{
      id: "session_1",
      userId: "user_1",
      token: "pending_token",
      expiresAt: new Date("2026-04-22T16:20:00.000Z"),
      consumedAt: null,
      telegramChatId: null,
      telegramUserId: null,
      telegramUsername: null,
      createdAt: new Date("2026-04-22T16:00:00.000Z"),
      updatedAt: new Date("2026-04-22T16:00:00.000Z")
    }]
  });

  process.env.NEXT_PUBLIC_TELEGRAM_BOT_USERNAME = "uliquid_desk_bot";

  registerSettingsCoreRoutes(app as any, createDeps(db));
  const handler = getFinalHandler(app, "delete", "/settings/alerts/telegram/link");
  const res = createMockRes();

  await handler({}, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body?.status, "not_connected");
  assert.equal(db.state.users[0]?.telegramChatId, null);
});

test("alerts/test still works after successful linking", async () => {
  const app = createFakeApp();
  const db = createTelegramTestDb({
    users: [{ id: "user_1", telegramChatId: "123456789" }]
  });
  const sentMessages: string[] = [];

  registerSettingsCoreRoutes(app as any, createDeps(db, sentMessages));
  const handler = getFinalHandler(app, "post", "/alerts/test");
  const res = createMockRes();

  await handler({}, res);

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { ok: true });
  assert.equal(sentMessages.length, 1);
  assert.equal(sentMessages[0]?.includes("uLiquid Desk Telegram test"), true);
});
