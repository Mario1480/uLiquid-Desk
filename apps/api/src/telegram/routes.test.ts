import assert from "node:assert/strict";
import test from "node:test";
import { registerTelegramRoutes } from "./routes.js";
import { createTelegramTestDb } from "./testDb.js";

type RouteMap = Map<string, Array<(...args: any[]) => any>>;

function createFakeApp() {
  const postRoutes: RouteMap = new Map();
  return {
    post(path: string, ...handlers: Array<(...args: any[]) => any>) {
      postRoutes.set(path, handlers);
    },
    routes: {
      post: postRoutes
    }
  };
}

function createMockRes() {
  return {
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

function getFinalPostHandler(app: ReturnType<typeof createFakeApp>, path: string) {
  const handlers = app.routes.post.get(path);
  if (!handlers?.length) throw new Error(`route_not_found:${path}`);
  return handlers[handlers.length - 1];
}

test("telegram webhook consumes /start link token and replies with success", async () => {
  const app = createFakeApp();
  const db = createTelegramTestDb({
    users: [{ id: "user_1", telegramChatId: null }],
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
  const messages: Array<{ chatId: string; text: string }> = [];

  registerTelegramRoutes(app as any, {
    db,
    now: () => new Date("2026-04-22T16:05:00.000Z"),
    resolveWebhookSecret: () => "secret",
    resolveBotToken: async () => "bot-token",
    sendTelegramMessage: async ({ chatId, text }) => {
      messages.push({ chatId, text });
    }
  });

  const handler = getFinalPostHandler(app, "/telegram/webhook/:secret");
  const res = createMockRes();
  await handler({
    params: { secret: "secret" },
    header(name: string) {
      return name.toLowerCase() === "x-telegram-bot-api-secret-token" ? "secret" : null;
    },
    body: {
      message: {
        text: "/start link_pending_token",
        chat: { id: 123456789, type: "private" },
        from: { id: 777, username: "desk_user" }
      }
    }
  }, res);

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { ok: true, linked: true, status: "connected" });
  assert.equal(db.state.users[0]?.telegramChatId, "123456789");
  assert.equal(messages.length, 1);
  assert.equal(messages[0]?.chatId, "123456789");
});

test("telegram webhook rejects wrong secret", async () => {
  const app = createFakeApp();
  registerTelegramRoutes(app as any, {
    db: createTelegramTestDb(),
    resolveWebhookSecret: () => "secret"
  });

  const handler = getFinalPostHandler(app, "/telegram/webhook/:secret");
  const res = createMockRes();
  await handler({
    params: { secret: "wrong" },
    header() {
      return null;
    },
    body: {}
  }, res);

  assert.equal(res.statusCode, 404);
  assert.deepEqual(res.body, { error: "not_found" });
});

test("telegram webhook ignores non-linking or non-private updates", async () => {
  const app = createFakeApp();
  registerTelegramRoutes(app as any, {
    db: createTelegramTestDb(),
    resolveWebhookSecret: () => "secret"
  });

  const handler = getFinalPostHandler(app, "/telegram/webhook/:secret");
  const res = createMockRes();
  await handler({
    params: { secret: "secret" },
    header() {
      return null;
    },
    body: {
      message: {
        text: "/start",
        chat: { id: -10001, type: "group" }
      }
    }
  }, res);

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { ok: true, ignored: true });
});

test("telegram webhook reports expired token without linking", async () => {
  const app = createFakeApp();
  const db = createTelegramTestDb({
    users: [{ id: "user_1", telegramChatId: null }],
    sessions: [{
      id: "session_1",
      userId: "user_1",
      token: "expired_token",
      expiresAt: new Date("2026-04-22T16:00:00.000Z"),
      consumedAt: null,
      telegramChatId: null,
      telegramUserId: null,
      telegramUsername: null,
      createdAt: new Date("2026-04-22T15:40:00.000Z"),
      updatedAt: new Date("2026-04-22T15:40:00.000Z")
    }]
  });
  const messages: string[] = [];

  registerTelegramRoutes(app as any, {
    db,
    now: () => new Date("2026-04-22T16:05:00.000Z"),
    resolveWebhookSecret: () => "secret",
    resolveBotToken: async () => "bot-token",
    sendTelegramMessage: async ({ text }) => {
      messages.push(text);
    }
  });

  const handler = getFinalPostHandler(app, "/telegram/webhook/:secret");
  const res = createMockRes();
  await handler({
    params: { secret: "secret" },
    header() {
      return "secret";
    },
    body: {
      message: {
        text: "/start link_expired_token",
        chat: { id: 123456789, type: "private" },
        from: { id: 777 }
      }
    }
  }, res);

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { ok: true, linked: false, status: "expired" });
  assert.equal(db.state.users[0]?.telegramChatId, null);
  assert.equal(messages.length, 1);
});
