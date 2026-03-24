import assert from "node:assert/strict";
import test from "node:test";
import { resolveAdminTelegramUpdate } from "./routes-operations.js";

test("resolveAdminTelegramUpdate keeps existing token on chat-only updates", () => {
  const resolved = resolveAdminTelegramUpdate({
    currentToken: "existing-token",
    currentSystemChatId: "-1001",
    requestedToken: null,
    tokenProvided: true,
    requestedSystemChatId: "-1002",
    systemChatIdProvided: true,
    clearConfig: false
  });

  assert.deepEqual(resolved, {
    token: "existing-token",
    systemTelegramChatId: "-1002"
  });
});

test("resolveAdminTelegramUpdate clears the full config when requested", () => {
  const resolved = resolveAdminTelegramUpdate({
    currentToken: "existing-token",
    currentSystemChatId: "-1001",
    requestedToken: "new-token",
    tokenProvided: true,
    requestedSystemChatId: "-1002",
    systemChatIdProvided: true,
    clearConfig: true
  });

  assert.deepEqual(resolved, {
    token: null,
    systemTelegramChatId: null
  });
});
