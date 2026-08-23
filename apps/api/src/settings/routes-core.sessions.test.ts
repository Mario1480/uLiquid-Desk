import crypto from "node:crypto";
import assert from "node:assert/strict";
import test from "node:test";
import { SESSION_COOKIE } from "../auth/cookies.js";
import { registerSettingsCoreRoutes } from "./routes-core.js";

type RouteMap = Map<string, Array<(...args: any[]) => any>>;

function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function createFakeApp() {
  const getRoutes: RouteMap = new Map();
  const postRoutes: RouteMap = new Map();
  const deleteRoutes: RouteMap = new Map();
  return {
    get(path: string, ...handlers: Array<(...args: any[]) => any>) {
      getRoutes.set(path, handlers);
    },
    post(path: string, ...handlers: Array<(...args: any[]) => any>) {
      postRoutes.set(path, handlers);
    },
    put() {
      // not needed for this suite
    },
    delete(path: string, ...handlers: Array<(...args: any[]) => any>) {
      deleteRoutes.set(path, handlers);
    },
    routes: {
      get: getRoutes,
      post: postRoutes,
      delete: deleteRoutes
    }
  };
}

function createMockRes(userId = "user_1") {
  return {
    locals: {
      user: {
        id: userId,
        email: `${userId}@example.com`
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
    },
    clearCookie() {
      return this;
    }
  };
}

function getFinalHandler(app: ReturnType<typeof createFakeApp>, method: "get" | "post" | "delete", path: string) {
  const handlers = app.routes[method].get(path);
  if (!handlers?.length) throw new Error(`route_not_found:${method}:${path}`);
  return handlers[handlers.length - 1];
}

function createSessionDb(rows: any[]) {
  const state = {
    users: [
      {
        id: "user_1",
        email: "user_1@example.com",
        walletAddress: "0xUser",
        passwordHash: "hash",
        telegramChatId: "123",
        emailVerifiedAt: new Date("2026-05-18T08:00:00.000Z"),
        allowManualTrading: true,
        agentWallet: "0xAgent",
        agentSecretRef: "secret",
        agentLastBalanceAt: new Date("2026-05-18T08:00:00.000Z"),
        agentLastBalanceWei: "100",
        agentLastBalanceFormatted: "0.1"
      }
    ],
    blockers: {
      runningBots: 0,
      activeGridBots: 0,
      activeBotVaults: 0,
      fundedBotVaults: 0,
      fundedFundingVaults: 0
    },
    sessions: [...rows],
    legalAcknowledgements: [
      {
        id: "legal_1",
        userId: "user_1",
        version: "2026-05-17",
        textHash: "hash_1",
        acceptedAt: new Date("2026-05-17T12:00:00.000Z"),
        createdAt: new Date("2026-05-17T12:00:00.000Z")
      }
    ],
    mobilePushTokens: [
      {
        id: "push_1",
        userId: "user_1",
        platform: "ios",
        environment: "production",
        bundleId: "vip.uliquid.desk",
        deviceId: "device_1",
        appVersion: "1.0.0",
        enabled: true,
        lastSeenAt: new Date("2026-05-19T08:00:00.000Z"),
        revokedAt: null,
        createdAt: new Date("2026-05-18T08:00:00.000Z")
      },
      {
        id: "push_foreign",
        userId: "user_2",
        platform: "ios",
        environment: "production",
        bundleId: "vip.uliquid.desk",
        deviceId: "device_2",
        appVersion: "1.0.0",
        enabled: true,
        lastSeenAt: new Date("2026-05-19T07:00:00.000Z"),
        revokedAt: null,
        createdAt: new Date("2026-05-18T07:00:00.000Z")
      }
    ]
  };

  const deleteManyByUserId = (key: "sessions" | "mobilePushTokens") => async ({ where }: any) => {
    const before = state[key].length;
    state[key] = state[key].filter((row: any) => {
      if (where.id && row.id !== where.id) return true;
      if (where.userId && row.userId !== where.userId) return true;
      if (where.tokenHash?.not && row.tokenHash === where.tokenHash.not) return true;
      return false;
    }) as any;
    return { count: before - state[key].length };
  };
  const noOpDeleteMany = async () => ({ count: 0 });
  const noOpUpdateMany = async () => ({ count: 0 });
  const db: any = {
    state,
    session: {
      findMany: async ({ where }: any) =>
        state.sessions
          .filter((row) => row.userId === where.userId)
          .sort((a, b) => b.lastActiveAt.getTime() - a.lastActiveAt.getTime()),
      findFirst: async ({ where }: any) =>
        state.sessions.find((row) => row.id === where.id && row.userId === where.userId) ?? null,
      deleteMany: deleteManyByUserId("sessions")
    },
    user: {
      update: async ({ where, data }: any) => {
        const row = state.users.find((entry) => entry.id === where.id);
        if (!row) throw new Error("user_not_found");
        Object.assign(row, data);
        return row;
      }
    },
    userLegalAcknowledgement: {
      findMany: async ({ where }: any) =>
        state.legalAcknowledgements
          .filter((row) => row.userId === where.userId)
          .sort((a, b) => b.acceptedAt.getTime() - a.acceptedAt.getTime())
    },
    mobilePushToken: {
      findMany: async ({ where }: any) =>
        state.mobilePushTokens
          .filter((row) => row.userId === where.userId)
          .sort((a, b) => b.lastSeenAt.getTime() - a.lastSeenAt.getTime()),
      deleteMany: deleteManyByUserId("mobilePushTokens"),
      updateMany: async ({ where, data }: any) => {
        let count = 0;
        state.mobilePushTokens = state.mobilePushTokens.map((row) => {
          if (where.id && row.id !== where.id) return row;
          if (where.userId && row.userId !== where.userId) return row;
          if (where.revokedAt === null && row.revokedAt !== null) return row;
          count += 1;
          return { ...row, ...data };
        });
        return { count };
      }
    },
    bot: { count: async () => state.blockers.runningBots },
    gridBotInstance: { count: async () => state.blockers.activeGridBots },
    botVault: {
      count: async ({ where }: any) =>
        where?.OR ? state.blockers.fundedBotVaults : state.blockers.activeBotVaults
    },
    fundingVault: { count: async () => state.blockers.fundedFundingVaults },
    reauthSession: { deleteMany: noOpDeleteMany },
    reauthOtp: { deleteMany: noOpDeleteMany },
    telegramLinkSession: { deleteMany: noOpDeleteMany },
    userAiPromptTemplate: { deleteMany: noOpDeleteMany },
    mobileWatchlistItem: { deleteMany: noOpDeleteMany },
    gridTemplateFavorite: { deleteMany: noOpDeleteMany },
    globalSetting: { deleteMany: noOpDeleteMany },
    siweNonce: { updateMany: noOpUpdateMany },
    userSubscription: { updateMany: noOpUpdateMany },
    affiliateProfile: { updateMany: noOpUpdateMany },
    exchangeAccount: { updateMany: noOpUpdateMany },
    $transaction: async (fn: any) => fn(db)
  };
  return db;
}

function createDeps(db: any) {
  return {
    db,
    isSuperadminEmail: () => false,
    resolveUserContext: async () => ({ isSuperadmin: false }),
    getSecurityGlobalSettings: async () => ({ reauthOtpEnabled: true }),
    setSecurityGlobalSettings: async () => undefined,
    getSecurityUserReauthOverride: async () => null,
    setSecurityUserReauthOverride: async () => undefined,
    getAllowedExchangeValues: async () => [],
    getExchangeOptionsResponse: () => ({ items: [] }),
    getServerInfoSettings: async () => ({ serverIpAddress: null }),
    getDailyEconomicCalendarSettingsForUser: async () => ({}),
    updateDailyEconomicCalendarSettingsForUser: async ({ patch }: any) => patch,
    getNotificationPluginSettingsForUser: async () => ({}),
    updateNotificationPluginSettingsForUser: async ({ patch }: any) => patch,
    getNotificationDestinationsSettingsForUser: async () => ({}),
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
    isApnsConfigured: () => true,
    computeRemaining: (limit: number | null, usage: number) => (limit === null ? null : Math.max(limit - usage, 0))
  } as any;
}

function createAppWithSessions() {
  const app = createFakeApp();
  const db = createSessionDb([
    {
      id: "session_current",
      userId: "user_1",
      tokenHash: hashToken("current_token"),
      createdAt: new Date("2026-05-18T10:00:00.000Z"),
      lastActiveAt: new Date("2026-05-19T10:00:00.000Z"),
      expiresAt: new Date("2026-06-18T10:00:00.000Z")
    },
    {
      id: "session_other",
      userId: "user_1",
      tokenHash: hashToken("other_token"),
      createdAt: new Date("2026-05-17T10:00:00.000Z"),
      lastActiveAt: new Date("2026-05-18T10:00:00.000Z"),
      expiresAt: new Date("2026-06-17T10:00:00.000Z")
    },
    {
      id: "session_foreign",
      userId: "user_2",
      tokenHash: hashToken("foreign_token"),
      createdAt: new Date("2026-05-17T10:00:00.000Z"),
      lastActiveAt: new Date("2026-05-18T10:00:00.000Z"),
      expiresAt: new Date("2026-06-17T10:00:00.000Z")
    }
  ]);
  registerSettingsCoreRoutes(app as any, createDeps(db));
  return { app, db };
}

test("settings sessions list marks the current session without leaking token hashes", async () => {
  const { app } = createAppWithSessions();
  const handler = getFinalHandler(app, "get", "/settings/sessions");
  const res = createMockRes();

  await handler({ cookies: { [SESSION_COOKIE]: "current_token" } }, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.items.length, 2);
  assert.equal(res.body.items[0].id, "session_current");
  assert.equal(res.body.items[0].isCurrent, true);
  assert.equal("tokenHash" in res.body.items[0], false);
  assert.equal(res.body.items[1].isCurrent, false);
});

test("settings sessions can revoke another own session", async () => {
  const { app, db } = createAppWithSessions();
  const handler = getFinalHandler(app, "delete", "/settings/sessions/:id");
  const res = createMockRes();

  await handler({ cookies: { [SESSION_COOKIE]: "current_token" }, params: { id: "session_other" } }, res);

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { ok: true });
  assert.equal(db.state.sessions.some((row: any) => row.id === "session_other"), false);
  assert.equal(db.state.sessions.some((row: any) => row.id === "session_current"), true);
});

test("settings sessions blocks current session revoke through single-session route", async () => {
  const { app, db } = createAppWithSessions();
  const handler = getFinalHandler(app, "delete", "/settings/sessions/:id");
  const res = createMockRes();

  await handler({ cookies: { [SESSION_COOKIE]: "current_token" }, params: { id: "session_current" } }, res);

  assert.equal(res.statusCode, 400);
  assert.equal(res.body.error, "current_session_cannot_be_revoked_here");
  assert.equal(db.state.sessions.some((row: any) => row.id === "session_current"), true);
});

test("settings sessions revoke others preserves the current session", async () => {
  const { app, db } = createAppWithSessions();
  const handler = getFinalHandler(app, "delete", "/settings/sessions");
  const res = createMockRes();

  await handler({ cookies: { [SESSION_COOKIE]: "current_token" }, query: { scope: "others" } }, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.deletedCount, 1);
  assert.equal(db.state.sessions.some((row: any) => row.id === "session_current"), true);
  assert.equal(db.state.sessions.some((row: any) => row.id === "session_other"), false);
  assert.equal(db.state.sessions.some((row: any) => row.id === "session_foreign"), true);
});

test("settings sessions returns not found for foreign session ids", async () => {
  const { app } = createAppWithSessions();
  const handler = getFinalHandler(app, "delete", "/settings/sessions/:id");
  const res = createMockRes();

  await handler({ cookies: { [SESSION_COOKIE]: "current_token" }, params: { id: "session_foreign" } }, res);

  assert.equal(res.statusCode, 404);
  assert.equal(res.body.error, "session_not_found");
});

test("settings legal acknowledgements expose latest own acknowledgement", async () => {
  const { app } = createAppWithSessions();
  const handler = getFinalHandler(app, "get", "/settings/legal-acknowledgements");
  const res = createMockRes();

  await handler({}, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.currentVersion, "2026-05-17");
  assert.equal(res.body.latest.version, "2026-05-17");
  assert.equal(res.body.latest.acceptedAt, "2026-05-17T12:00:00.000Z");
});

test("settings mobile push lists own registered devices", async () => {
  const { app } = createAppWithSessions();
  const handler = getFinalHandler(app, "get", "/settings/mobile-push");
  const res = createMockRes();

  await handler({}, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.enabled, true);
  assert.equal(res.body.apnsConfigured, true);
  assert.equal(res.body.tokens.length, 1);
  assert.equal(res.body.tokens[0].id, "push_1");
  assert.equal(res.body.tokens[0].lastSeenAt, "2026-05-19T08:00:00.000Z");
});

test("settings mobile push revokes only own device tokens", async () => {
  const { app, db } = createAppWithSessions();
  const handler = getFinalHandler(app, "delete", "/settings/mobile-push/:id");
  const res = createMockRes();

  await handler({ params: { id: "push_1" } }, res);

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { ok: true });
  assert.equal(db.state.mobilePushTokens.find((row: any) => row.id === "push_1")?.enabled, false);
  assert.ok(db.state.mobilePushTokens.find((row: any) => row.id === "push_1")?.revokedAt instanceof Date);
  assert.equal(db.state.mobilePushTokens.find((row: any) => row.id === "push_foreign")?.enabled, true);
});

test("settings mobile push hides foreign token ids behind not found", async () => {
  const { app } = createAppWithSessions();
  const handler = getFinalHandler(app, "delete", "/settings/mobile-push/:id");
  const res = createMockRes();

  await handler({ params: { id: "push_foreign" } }, res);

  assert.equal(res.statusCode, 404);
  assert.equal(res.body.error, "push_token_not_found");
});

test("settings account deletion summary reports blockers", async () => {
  const { app, db } = createAppWithSessions();
  db.state.blockers.runningBots = 1;
  db.state.blockers.fundedFundingVaults = 1;
  const handler = getFinalHandler(app, "get", "/settings/account-deletion");
  const res = createMockRes();

  await handler({}, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.canDelete, false);
  assert.deepEqual(
    res.body.blockers.map((blocker: any) => blocker.code),
    ["running_bots", "funded_funding_vaults"]
  );
});

test("settings account deletion blocks until running capital surfaces are resolved", async () => {
  const { app, db } = createAppWithSessions();
  db.state.blockers.activeBotVaults = 1;
  const handler = getFinalHandler(app, "post", "/settings/account/delete");
  const res = createMockRes();

  await handler({ body: { confirmEmail: "user_1@example.com", confirmText: "DELETE" } }, res);

  assert.equal(res.statusCode, 409);
  assert.equal(res.body.error, "account_deletion_blocked");
  assert.equal(db.state.users[0].email, "user_1@example.com");
});

test("settings account deletion anonymizes account and revokes sessions", async () => {
  const { app, db } = createAppWithSessions();
  const handler = getFinalHandler(app, "post", "/settings/account/delete");
  const res = createMockRes();

  await handler({ body: { confirmEmail: "user_1@example.com", confirmText: "DELETE" } }, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.ok, true);
  assert.match(db.state.users[0].email, /^deleted-user_1-\d+@deleted\.local$/);
  assert.equal(db.state.users[0].walletAddress, null);
  assert.equal(db.state.users[0].passwordHash, null);
  assert.equal(db.state.users[0].telegramChatId, null);
  assert.equal(db.state.sessions.some((row: any) => row.userId === "user_1"), false);
  assert.equal(db.state.mobilePushTokens.some((row: any) => row.userId === "user_1"), false);
});
