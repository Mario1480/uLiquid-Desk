import assert from "node:assert/strict";
import test from "node:test";
import { registerAdminOperationsRoutes, resolveAdminTelegramUpdate } from "./routes-operations.js";

function createFakeApp() {
  const routes = {
    delete: new Map<string, Array<(...args: any[]) => any>>(),
    get: new Map<string, Array<(...args: any[]) => any>>(),
    post: new Map<string, Array<(...args: any[]) => any>>(),
    put: new Map<string, Array<(...args: any[]) => any>>()
  };
  return {
    delete(path: string, ...handlers: Array<(...args: any[]) => any>) {
      routes.delete.set(path, handlers);
    },
    get(path: string, ...handlers: Array<(...args: any[]) => any>) {
      routes.get.set(path, handlers);
    },
    post(path: string, ...handlers: Array<(...args: any[]) => any>) {
      routes.post.set(path, handlers);
    },
    put(path: string, ...handlers: Array<(...args: any[]) => any>) {
      routes.put.set(path, handlers);
    },
    routes
  };
}

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

test("registerAdminOperationsRoutes leaves GET /admin/users to platform admin routes", () => {
  const app = createFakeApp();
  registerAdminOperationsRoutes(app as any, {} as any);

  assert.equal(app.routes.get.has("/admin/users"), false);
  assert.equal(app.routes.post.has("/admin/users"), true);
  assert.equal(app.routes.put.has("/admin/users/:id/password"), true);
  assert.equal(app.routes.delete.has("/admin/users/:id"), true);
});
