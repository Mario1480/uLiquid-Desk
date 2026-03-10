import assert from "node:assert/strict";
import test from "node:test";
import {
  createIdempotencyMiddleware,
  createRateLimitMiddleware,
  readIdempotencyKey,
  rateLimitByIp
} from "./trafficControl.js";

function createReqRes(params?: {
  ip?: string;
  body?: Record<string, unknown>;
  headers?: Record<string, string>;
  cookies?: Record<string, string>;
}) {
  const headers = new Map<string, string>();
  for (const [key, value] of Object.entries(params?.headers ?? {})) {
    headers.set(key.toLowerCase(), value);
  }
  const res: any = {
    locals: {},
    statusCode: 200,
    writableEnded: true,
    headers: {} as Record<string, string>,
    on() {
      return res;
    },
    setHeader(name: string, value: string) {
      res.headers[name] = value;
    },
    status(code: number) {
      res.statusCode = code;
      return res;
    },
    json(payload: unknown) {
      res.body = payload;
      return res;
    }
  };
  const req: any = {
    ip: params?.ip ?? "127.0.0.1",
    body: params?.body ?? {},
    cookies: params?.cookies ?? {},
    get(name: string) {
      return headers.get(name.toLowerCase()) ?? null;
    },
    headers: Object.fromEntries(headers.entries())
  };
  return { req, res };
}

test("readIdempotencyKey prefers header and falls back to body", () => {
  const fromHeader = createReqRes({
    headers: { "x-idempotency-key": "idem-header" },
    body: { idempotencyKey: "idem-body" }
  });
  assert.equal(readIdempotencyKey(fromHeader.req as any), "idem-header");

  const fromBody = createReqRes({
    body: { idempotencyKey: "idem-body" }
  });
  assert.equal(readIdempotencyKey(fromBody.req as any), "idem-body");
});

test("createRateLimitMiddleware returns 429 after threshold", async () => {
  const middleware = createRateLimitMiddleware({
    name: `test_rate_limit_${Date.now()}`,
    max: 1,
    windowMs: 60_000,
    keyFn: rateLimitByIp
  });

  const first = createReqRes({ ip: "10.0.0.1" });
  let nextCalls = 0;
  await middleware(first.req as any, first.res as any, () => {
    nextCalls += 1;
  });

  const second = createReqRes({ ip: "10.0.0.1" });
  await middleware(second.req as any, second.res as any, () => {
    nextCalls += 1;
  });

  assert.equal(nextCalls, 1);
  assert.equal(second.res.statusCode, 429);
  assert.equal(second.res.body?.error, "rate_limited");
  assert.equal(typeof second.res.headers["Retry-After"], "string");
});

test("createIdempotencyMiddleware replays successful responses", async () => {
  const middleware = createIdempotencyMiddleware({
    name: `test_idempotency_${Date.now()}`,
    required: true,
    ttlMs: 60_000
  });

  const first = createReqRes({
    body: { idempotencyKey: "idem-1" }
  });
  let firstNextCalled = false;
  await middleware(first.req as any, first.res as any, () => {
    firstNextCalled = true;
  });
  assert.equal(firstNextCalled, true);
  first.res.json({ ok: true, call: 1 });

  const second = createReqRes({
    body: { idempotencyKey: "idem-1" }
  });
  let secondNextCalled = false;
  await middleware(second.req as any, second.res as any, () => {
    secondNextCalled = true;
  });

  assert.equal(secondNextCalled, false);
  assert.equal(second.res.statusCode, 200);
  assert.deepEqual(second.res.body, { ok: true, call: 1 });
});
