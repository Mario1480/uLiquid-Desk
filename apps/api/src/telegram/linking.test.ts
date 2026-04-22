import assert from "node:assert/strict";
import test from "node:test";
import {
  buildTelegramConnectUrl,
  buildTelegramStartPayload,
  consumeTelegramLinkSession,
  createTelegramLinkSession,
  createTelegramLinkStatus,
  generateTelegramLinkToken,
  getTelegramLinkStatus,
  parseTelegramStartToken
} from "./linking.js";
import { createTelegramTestDb } from "./testDb.js";

test("generateTelegramLinkToken returns url-safe token", () => {
  const token = generateTelegramLinkToken();
  assert.match(token, /^[A-Za-z0-9_-]+$/);
  assert.ok(token.length <= 64);
});

test("parseTelegramStartToken extracts linking token from start command", () => {
  assert.equal(parseTelegramStartToken("/start link_abc-123"), "abc-123");
  assert.equal(parseTelegramStartToken("/start@uliquid_desk_bot link_token"), "token");
  assert.equal(parseTelegramStartToken("/help"), null);
  assert.equal(parseTelegramStartToken("/start bad"), null);
});

test("buildTelegramConnectUrl uses deep-link start payload", () => {
  assert.equal(
    buildTelegramConnectUrl({ botUsername: "uliquid_desk_bot", token: "abc123" }),
    "https://t.me/uliquid_desk_bot?start=link_abc123"
  );
  assert.equal(buildTelegramStartPayload("abc123"), "link_abc123");
});

test("createTelegramLinkStatus prefers connected state over pending link", () => {
  const status = createTelegramLinkStatus({
    botUsername: "uliquid_desk_bot",
    connectedChatId: "123456789",
    pendingToken: "will_be_ignored",
    pendingExpiresAt: new Date("2026-04-22T17:00:00.000Z")
  });
  assert.equal(status.status, "connected");
  assert.equal(status.connectUrl, null);
  assert.equal(status.connectedChatId, "123***789");
});

test("createTelegramLinkSession replaces prior open session and exposes pending status", async () => {
  const now = new Date("2026-04-22T16:00:00.000Z");
  const db = createTelegramTestDb({
    users: [{ id: "user_1", telegramChatId: null }],
    sessions: [{
      id: "existing",
      userId: "user_1",
      token: "old_token",
      expiresAt: new Date("2026-04-22T16:20:00.000Z"),
      consumedAt: null,
      telegramChatId: null,
      telegramUserId: null,
      telegramUsername: null,
      createdAt: new Date("2026-04-22T15:59:00.000Z"),
      updatedAt: new Date("2026-04-22T15:59:00.000Z")
    }]
  });

  const status = await createTelegramLinkSession({
    db,
    userId: "user_1",
    now,
    ttlMinutes: 15,
    botUsername: "uliquid_desk_bot"
  });

  assert.equal(status.status, "pending");
  assert.match(String(status.connectUrl), /^https:\/\/t\.me\/uliquid_desk_bot\?start=link_/);
  assert.equal(db.state.sessions.filter((entry) => entry.userId === "user_1").length, 2);
  const expiredOld = db.state.sessions.find((entry) => entry.token === "old_token");
  assert.equal(expiredOld?.expiresAt.toISOString(), now.toISOString());
});

test("getTelegramLinkStatus returns pending session for disconnected user", async () => {
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

  const status = await getTelegramLinkStatus({
    db,
    userId: "user_1",
    now: new Date("2026-04-22T16:05:00.000Z"),
    botUsername: "uliquid_desk_bot"
  });

  assert.equal(status.status, "pending");
  assert.match(String(status.connectUrl), /pending_token$/);
});

test("consumeTelegramLinkSession links user and consumes token once", async () => {
  const now = new Date("2026-04-22T16:05:00.000Z");
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

  const first = await consumeTelegramLinkSession({
    db,
    token: "pending_token",
    telegramChatId: "123456789",
    telegramUserId: "777",
    telegramUsername: "desk_user",
    now
  });

  assert.deepEqual(first, {
    ok: true,
    status: "connected",
    userId: "user_1",
    chatId: "123456789"
  });
  assert.equal(db.state.users[0]?.telegramChatId, "123456789");

  const second = await consumeTelegramLinkSession({
    db,
    token: "pending_token",
    telegramChatId: "123456789",
    now
  });
  assert.equal(second.ok, false);
  assert.equal(second.status, "consumed");
});

test("consumeTelegramLinkSession rejects expired token", async () => {
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

  const result = await consumeTelegramLinkSession({
    db,
    token: "expired_token",
    telegramChatId: "123456789",
    now: new Date("2026-04-22T16:05:00.000Z")
  });

  assert.equal(result.ok, false);
  assert.equal(result.status, "expired");
});

test("consumeTelegramLinkSession rejects invalid token", async () => {
  const db = createTelegramTestDb({
    users: [{ id: "user_1", telegramChatId: null }]
  });

  const result = await consumeTelegramLinkSession({
    db,
    token: "missing_token",
    telegramChatId: "123456789"
  });

  assert.equal(result.ok, false);
  assert.equal(result.status, "invalid");
});

test("consumeTelegramLinkSession enforces chat-id conflict checks", async () => {
  const db = createTelegramTestDb({
    users: [
      { id: "user_1", telegramChatId: null },
      { id: "user_2", telegramChatId: "123456789" }
    ],
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

  const result = await consumeTelegramLinkSession({
    db,
    token: "pending_token",
    telegramChatId: "123456789",
    now: new Date("2026-04-22T16:05:00.000Z")
  });

  assert.equal(result.ok, false);
  assert.equal(result.status, "conflict");
  assert.equal(db.state.users[0]?.telegramChatId, null);
});
