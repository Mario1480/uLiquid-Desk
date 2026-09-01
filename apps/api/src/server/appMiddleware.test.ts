import assert from "node:assert/strict";
import test from "node:test";
import {
  CSRF_COOKIE,
  CSRF_HEADER,
  PRESALE_CSRF_COOKIE,
  PRESALE_SESSION_COOKIE,
  SESSION_COOKIE
} from "../auth/cookies.js";
import { enforceSessionCsrf, resolveRequestTimeoutMs } from "./appMiddleware.js";

function createReq(params: {
  method: string;
  path?: string;
  cookies?: Record<string, string>;
  headers?: Record<string, string>;
}) {
  const headers = Object.fromEntries(
    Object.entries(params.headers ?? {}).map(([key, value]) => [key.toLowerCase(), value])
  );
  return {
    method: params.method,
    path: params.path ?? "/",
    cookies: params.cookies ?? {},
    get(name: string) {
      return headers[name.toLowerCase()];
    }
  };
}

function createRes() {
  return {
    statusCode: 200,
    body: null as unknown,
    cookies: [] as Array<{ name: string; value: string; options: Record<string, unknown> }>,
    cookie(name: string, value: string, options: Record<string, unknown>) {
      this.cookies.push({ name, value, options });
      return this;
    },
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      this.body = payload;
      return this;
    }
  };
}

test("enforceSessionCsrf issues a readable csrf cookie on safe session requests", () => {
  const req = createReq({
    method: "GET",
    cookies: { [SESSION_COOKIE]: "session-token" }
  });
  const res = createRes();
  let nextCalled = false;

  enforceSessionCsrf(req as any, res as any, () => {
    nextCalled = true;
  });

  assert.equal(nextCalled, true);
  const cookie = res.cookies.find((entry) => entry.name === CSRF_COOKIE);
  assert.ok(cookie);
  assert.equal(cookie.options.httpOnly, false);
  assert.equal(typeof cookie.value, "string");
  assert.equal(cookie.value.length, 64);
});

test("enforceSessionCsrf blocks unsafe session requests without a matching token", () => {
  const req = createReq({
    method: "POST",
    cookies: {
      [SESSION_COOKIE]: "session-token",
      [CSRF_COOKIE]: "csrf-token"
    }
  });
  const res = createRes();
  let nextCalled = false;

  enforceSessionCsrf(req as any, res as any, () => {
    nextCalled = true;
  });

  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 403);
  assert.deepEqual(res.body, { error: "invalid_csrf_token" });
});

test("enforceSessionCsrf allows unsafe session requests with matching cookie and header", () => {
  const req = createReq({
    method: "POST",
    cookies: {
      [SESSION_COOKIE]: "session-token",
      [CSRF_COOKIE]: "csrf-token"
    },
    headers: {
      [CSRF_HEADER]: "csrf-token"
    }
  });
  const res = createRes();
  let nextCalled = false;

  enforceSessionCsrf(req as any, res as any, () => {
    nextCalled = true;
  });

  assert.equal(nextCalled, true);
  assert.equal(res.statusCode, 200);
});

test("enforceSessionCsrf ignores unauthenticated unsafe requests such as signed webhooks", () => {
  const req = createReq({ method: "POST" });
  const res = createRes();
  let nextCalled = false;

  enforceSessionCsrf(req as any, res as any, () => {
    nextCalled = true;
  });

  assert.equal(nextCalled, true);
  assert.equal(res.statusCode, 200);
});

test("enforceSessionCsrf isolates public presale csrf from Desk sessions", () => {
  const req = createReq({
    method: "POST",
    path: "/uliq/public/terms/accept",
    cookies: {
      [SESSION_COOKIE]: "desk-session",
      [PRESALE_SESSION_COOKIE]: "presale-session",
      [PRESALE_CSRF_COOKIE]: "presale-csrf",
      [CSRF_COOKIE]: "desk-csrf"
    },
    headers: {
      [CSRF_HEADER]: "presale-csrf"
    }
  });
  const res = createRes();
  let nextCalled = false;

  enforceSessionCsrf(req as any, res as any, () => {
    nextCalled = true;
  });

  assert.equal(nextCalled, true);
});

test("enforceSessionCsrf bootstraps public presale csrf for an existing Desk session", () => {
  const req = createReq({
    method: "GET",
    path: "/uliq/public/session/nonce",
    cookies: { [SESSION_COOKIE]: "desk-session" }
  });
  const res = createRes();
  let nextCalled = false;

  enforceSessionCsrf(req as any, res as any, () => {
    nextCalled = true;
  });

  assert.equal(nextCalled, true);
  assert.ok(res.cookies.some((entry) => entry.name === PRESALE_CSRF_COOKIE));
  assert.equal(res.cookies.some((entry) => entry.name === CSRF_COOKIE), false);
});

test("enforceSessionCsrf accepts public presale verification with only a Desk session", () => {
  const req = createReq({
    method: "POST",
    path: "/uliq/public/session/verify",
    cookies: {
      [SESSION_COOKIE]: "desk-session",
      [PRESALE_CSRF_COOKIE]: "presale-csrf"
    },
    headers: { [CSRF_HEADER]: "presale-csrf" }
  });
  const res = createRes();
  let nextCalled = false;

  enforceSessionCsrf(req as any, res as any, () => {
    nextCalled = true;
  });

  assert.equal(nextCalled, true);
  assert.equal(res.statusCode, 200);
});

test("enforceSessionCsrf rejects a Desk csrf token on public presale writes", () => {
  const req = createReq({
    method: "POST",
    path: "/uliq/public/terms/accept",
    cookies: {
      [SESSION_COOKIE]: "desk-session",
      [PRESALE_SESSION_COOKIE]: "presale-session",
      [PRESALE_CSRF_COOKIE]: "presale-csrf",
      [CSRF_COOKIE]: "desk-csrf"
    },
    headers: { [CSRF_HEADER]: "desk-csrf" }
  });
  const res = createRes();
  let nextCalled = false;

  enforceSessionCsrf(req as any, res as any, () => {
    nextCalled = true;
  });

  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 403);
});

test("resolveRequestTimeoutMs reserves a longer window for agent chat messages", () => {
  assert.equal(
    resolveRequestTimeoutMs(
      { method: "POST", path: "/api/agent-chat/conversations/conversation-id/messages" },
      {}
    ),
    120_000
  );
  assert.equal(resolveRequestTimeoutMs({ method: "GET", path: "/health" }, {}), 30_000);
});

test("resolveRequestTimeoutMs honors bounded request timeout overrides", () => {
  assert.equal(
    resolveRequestTimeoutMs(
      { method: "POST", path: "/api/agent-chat/conversations/conversation-id/messages" },
      { API_REQUEST_TIMEOUT_MS: "45000", API_AGENT_CHAT_REQUEST_TIMEOUT_MS: "150000" }
    ),
    150_000
  );
  assert.equal(resolveRequestTimeoutMs({ method: "GET", path: "/health" }, { API_REQUEST_TIMEOUT_MS: "invalid" }), 30_000);
});
