import assert from "node:assert/strict";
import test from "node:test";
import { registerSiweAuthRoutes } from "./auth-siwe.js";

type RouteMap = Map<string, Array<(...args: any[]) => any>>;

function createFakeApp() {
  const postRoutes: RouteMap = new Map();
  const getRoutes: RouteMap = new Map();

  return {
    post(path: string, ...handlers: Array<(...args: any[]) => any>) {
      postRoutes.set(path, handlers);
    },
    get(path: string, ...handlers: Array<(...args: any[]) => any>) {
      getRoutes.set(path, handlers);
    },
    routes: {
      post: postRoutes,
      get: getRoutes
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
    cookies: [] as Array<{ name: string; value: string; options?: Record<string, unknown> }>,
    clearedCookies: [] as Array<{ name: string; options?: Record<string, unknown> }>,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: any) {
      this.body = payload;
      return this;
    },
    cookie(name: string, value: string, options?: Record<string, unknown>) {
      this.cookies.push({ name, value, options });
      return this;
    },
    clearCookie(name: string, options?: Record<string, unknown>) {
      this.clearedCookies.push({ name, options });
      return this;
    }
  };
}

function getFinalHandler(app: ReturnType<typeof createFakeApp>, method: "post" | "get", path: string) {
  const handlers = app.routes[method].get(path);
  if (!handlers || handlers.length === 0) {
    throw new Error(`route_not_found:${method}:${path}`);
  }
  return handlers[handlers.length - 1];
}

test("GET /auth/siwe/nonce returns nonce and sets nonce cookie", async () => {
  const app = createFakeApp();

  registerSiweAuthRoutes(app as any, {
    db: {},
    siweService: {
      async issueNonce() {
        return {
          nonce: "nonce_1",
          expiresAt: new Date("2026-03-06T10:00:00.000Z"),
          token: "token_1",
          ttlMs: 600_000
        };
      },
      buildNonceCookieOptions() {
        return { httpOnly: true, sameSite: "lax", path: "/", maxAge: 600_000 };
      }
    }
  } as any);

  const handler = getFinalHandler(app, "get", "/auth/siwe/nonce");
  const req = {};
  const res = createMockRes();

  await handler(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body?.nonce, "nonce_1");
  assert.equal(typeof res.body?.expiresAt, "string");
  assert.equal(res.cookies.length, 1);
  assert.equal(res.cookies[0]?.name, "mm_siwe_nonce");
});

test("POST /auth/siwe/verify returns wallet_not_linked when address is unknown", async () => {
  const app = createFakeApp();

  registerSiweAuthRoutes(app as any, {
    db: {
      user: {
        async findUnique() {
          return null;
        }
      }
    },
    siweService: {
      async verify() {
        return {
          address: "0x1111111111111111111111111111111111111111"
        };
      },
      clearNonceCookie() {
        // noop
      }
    }
  } as any);

  const handler = getFinalHandler(app, "post", "/auth/siwe/verify");
  const req = {
    body: {
      message: "m",
      signature: "s"
    },
    cookies: {
      mm_siwe_nonce: "token"
    },
    get() {
      return "localhost:4000";
    }
  };
  const res = createMockRes();

  await handler(req, res);

  assert.equal(res.statusCode, 401);
  assert.equal(res.body?.error, "wallet_not_linked");
});

test("POST /auth/siwe/link returns conflict when wallet belongs to another user", async () => {
  const app = createFakeApp();

  registerSiweAuthRoutes(app as any, {
    db: {
      user: {
        async findUnique() {
          return { id: "other_user" };
        },
        async update() {
          throw new Error("should_not_update");
        }
      }
    },
    siweService: {
      async verify() {
        return {
          address: "0x2222222222222222222222222222222222222222"
        };
      },
      clearNonceCookie() {
        // noop
      }
    }
  } as any);

  const handler = getFinalHandler(app, "post", "/auth/siwe/link");
  const req = {
    body: {
      message: "m",
      signature: "s"
    },
    cookies: {
      mm_siwe_nonce: "token"
    },
    get() {
      return "localhost:4000";
    }
  };
  const res = createMockRes("user_1");

  await handler(req, res);

  assert.equal(res.statusCode, 409);
  assert.equal(res.body?.error, "wallet_already_linked");
});
