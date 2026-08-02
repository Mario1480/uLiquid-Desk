import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import {
  REAUTH_COOKIE,
  REAUTH_OTP_PURPOSE,
  createRecentReauthGuard,
  registerReauthRoutes
} from "./reauth.js";

type Handler = (...args: any[]) => any;

function createFakeApp() {
  const postRoutes = new Map<string, Handler[]>();
  return {
    post(path: string, ...handlers: Handler[]) {
      postRoutes.set(path, handlers);
    },
    routes: { post: postRoutes }
  };
}

function createMockRes(userId = "user_1") {
  return {
    locals: { user: { id: userId, email: "user@example.com" } } as Record<string, any>,
    statusCode: 200,
    body: null as any,
    cookies: [] as Array<{ name: string; value: string; options: Record<string, unknown> }>,
    clearedCookies: [] as string[],
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: any) {
      this.body = payload;
      return this;
    },
    cookie(name: string, value: string, options: Record<string, unknown>) {
      this.cookies.push({ name, value, options });
      return this;
    },
    clearCookie(name: string) {
      this.clearedCookies.push(name);
      return this;
    }
  };
}

function sha256(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function createDb() {
  const state = {
    sessions: [] as Array<{ id: string; userId: string; tokenHash: string; expiresAt: Date }>,
    otps: [] as Array<{
      id: string;
      userId: string;
      purpose: string;
      codeHash: string;
      attemptCount: number;
      lockedUntil: Date | null;
      createdAt: Date;
      expiresAt: Date;
    }>
  };

  function matchesDate(value: Date, condition: any): boolean {
    if (condition?.gt && value.getTime() <= new Date(condition.gt).getTime()) return false;
    if (condition?.lte && value.getTime() > new Date(condition.lte).getTime()) return false;
    return true;
  }

  function matchesSession(row: (typeof state.sessions)[number], where: any): boolean {
    if (where.id !== undefined && row.id !== where.id) return false;
    if (where.userId !== undefined && row.userId !== where.userId) return false;
    if (where.tokenHash !== undefined && row.tokenHash !== where.tokenHash) return false;
    if (where.expiresAt && !matchesDate(row.expiresAt, where.expiresAt)) return false;
    if (Array.isArray(where.OR)) return where.OR.some((entry: any) => matchesSession(row, entry));
    return true;
  }

  function matchesOtp(row: (typeof state.otps)[number], where: any): boolean {
    if (where.id !== undefined && row.id !== where.id) return false;
    if (where.userId !== undefined && row.userId !== where.userId) return false;
    if (where.purpose !== undefined && row.purpose !== where.purpose) return false;
    if (where.codeHash !== undefined && row.codeHash !== where.codeHash) return false;
    if (where.attemptCount !== undefined && row.attemptCount !== where.attemptCount) return false;
    if (where.expiresAt && !matchesDate(row.expiresAt, where.expiresAt)) return false;
    if (where.lockedUntil === null && row.lockedUntil !== null) return false;
    if (where.lockedUntil && typeof where.lockedUntil === "object") {
      if (!row.lockedUntil || !matchesDate(row.lockedUntil, where.lockedUntil)) return false;
    }
    if (Array.isArray(where.OR) && !where.OR.some((entry: any) => matchesOtp(row, entry))) return false;
    return true;
  }

  const db: any = {
    state,
    $transaction: async (callback: (tx: any) => Promise<any>) => callback(db),
    user: {
      findUnique: async ({ where }: any) => where.id === "user_1"
        ? {
            id: "user_1",
            email: "user@example.com",
            emailVerifiedAt: new Date("2026-01-01T00:00:00.000Z"),
            passwordHash: "password-hash"
          }
        : null
    },
    reauthSession: {
      findUnique: async ({ where }: any) => state.sessions.find((row) => row.tokenHash === where.tokenHash) ?? null,
      create: async ({ data }: any) => {
        const row = { id: `session_${state.sessions.length + 1}`, ...data };
        state.sessions.push(row);
        return row;
      },
      deleteMany: async ({ where }: any) => {
        const before = state.sessions.length;
        state.sessions = state.sessions.filter((row) => !matchesSession(row, where));
        return { count: before - state.sessions.length };
      }
    },
    reauthOtp: {
      findFirst: async ({ where }: any) => {
        const rows = state.otps
          .filter((row) => matchesOtp(row, where))
          .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime());
        return rows[0] ?? null;
      },
      create: async ({ data }: any) => {
        const row = {
          id: `otp_${state.otps.length + 1}`,
          createdAt: new Date(),
          ...data
        };
        state.otps.push(row);
        return row;
      },
      updateMany: async ({ where, data }: any) => {
        let count = 0;
        for (const row of state.otps) {
          if (!matchesOtp(row, where)) continue;
          if (data.attemptCount?.increment) row.attemptCount += Number(data.attemptCount.increment);
          row.lockedUntil = data.lockedUntil ?? null;
          count += 1;
        }
        return { count };
      },
      deleteMany: async ({ where }: any) => {
        const before = state.otps.length;
        state.otps = state.otps.filter((row) => !matchesOtp(row, where));
        return { count: before - state.otps.length };
      }
    }
  };

  return db;
}

function createDeps(db: any, overrides: Record<string, unknown> = {}) {
  return {
    db,
    verifyPassword: async (password: string) => password === "correct-password",
    generateNumericCode: () => "123456",
    hashOneTimeCode: sha256,
    sendReauthOtpEmail: async () => ({ ok: true }),
    ...overrides
  };
}

function handlerFor(app: ReturnType<typeof createFakeApp>, path: string): Handler {
  const handler = app.routes.post.get(path)?.at(-1);
  if (!handler) throw new Error(`route_not_found:${path}`);
  return handler;
}

test("password reauth stores only a token hash and sets an httpOnly cookie", async () => {
  const db = createDb();
  const app = createFakeApp();
  registerReauthRoutes(app as any, createDeps(db));
  const res = createMockRes();

  await handlerFor(app, "/auth/reauth")(
    { body: { password: "correct-password" } } as any,
    res as any
  );

  assert.equal(res.body?.ok, true);
  assert.equal(db.state.sessions.length, 1);
  const cookie = res.cookies.find((entry) => entry.name === REAUTH_COOKIE);
  assert.ok(cookie);
  assert.equal(cookie.options.httpOnly, true);
  assert.equal(cookie.options.sameSite, "lax");
  assert.notEqual(db.state.sessions[0]?.tokenHash, cookie.value);
  assert.equal(db.state.sessions[0]?.tokenHash, sha256(cookie.value));
});

test("password reauth rejects invalid credentials without creating a session", async () => {
  const db = createDb();
  const app = createFakeApp();
  registerReauthRoutes(app as any, createDeps(db));
  const res = createMockRes();

  await handlerFor(app, "/auth/reauth")(
    { body: { password: "wrong-password" } } as any,
    res as any
  );

  assert.equal(res.statusCode, 401);
  assert.equal(res.body?.error, "invalid_credentials");
  assert.equal(db.state.sessions.length, 0);
});

test("OTP reauth stores a hash, tracks failures, and issues a session on success", async () => {
  const db = createDb();
  const app = createFakeApp();
  registerReauthRoutes(app as any, createDeps(db));
  const requestRes = createMockRes();

  await handlerFor(app, "/auth/reauth/request-otp")({ body: {} } as any, requestRes as any);
  assert.equal(requestRes.body?.ok, true);
  assert.equal(requestRes.body?.devCode, "123456");
  assert.equal(db.state.otps.length, 1);
  assert.equal(db.state.otps[0]?.purpose, REAUTH_OTP_PURPOSE);
  assert.equal(db.state.otps[0]?.codeHash, sha256("123456"));

  const invalidRes = createMockRes();
  await handlerFor(app, "/auth/reauth/verify-otp")(
    { body: { code: "000000" } } as any,
    invalidRes as any
  );
  assert.equal(invalidRes.statusCode, 400);
  assert.equal(db.state.otps[0]?.attemptCount, 1);
  assert.equal(db.state.otps[0]?.lockedUntil, null);

  const validRes = createMockRes();
  await handlerFor(app, "/auth/reauth/verify-otp")(
    { body: { code: "123456" } } as any,
    validRes as any
  );
  assert.equal(validRes.body?.ok, true, JSON.stringify(validRes.body));
  assert.equal(db.state.otps.length, 0);
  assert.equal(db.state.sessions.length, 1);
});

test("only one concurrent OTP verification can claim the code", async () => {
  const db = createDb();
  const app = createFakeApp();
  registerReauthRoutes(app as any, createDeps(db));
  await handlerFor(app, "/auth/reauth/request-otp")({ body: {} } as any, createMockRes() as any);

  const firstRes = createMockRes();
  const secondRes = createMockRes();
  const verify = handlerFor(app, "/auth/reauth/verify-otp");
  await Promise.all([
    verify({ body: { code: "123456" } } as any, firstRes as any),
    verify({ body: { code: "123456" } } as any, secondRes as any)
  ]);

  const responses = [firstRes, secondRes];
  assert.equal(responses.filter((res) => res.body?.ok === true).length, 1);
  assert.equal(responses.filter((res) => res.body?.error === "invalid_or_expired_code").length, 1);
  assert.equal(db.state.sessions.length, 1);
  assert.equal(db.state.otps.length, 0);
});

test("OTP verification locks the code after the configured failed-attempt threshold", async () => {
  const previousMaxAttempts = process.env.AUTH_OTP_MAX_ATTEMPTS;
  process.env.AUTH_OTP_MAX_ATTEMPTS = "2";
  try {
    const db = createDb();
    const app = createFakeApp();
    registerReauthRoutes(app as any, createDeps(db));
    await handlerFor(app, "/auth/reauth/request-otp")({ body: {} } as any, createMockRes() as any);
    const verify = handlerFor(app, "/auth/reauth/verify-otp");

    await verify({ body: { code: "000000" } } as any, createMockRes() as any);
    await verify({ body: { code: "000000" } } as any, createMockRes() as any);
    assert.equal(db.state.otps[0]?.attemptCount, 2);
    assert.equal(db.state.otps[0]?.lockedUntil?.getTime(), db.state.otps[0]?.expiresAt.getTime());

    const lockedRes = createMockRes();
    await verify({ body: { code: "123456" } } as any, lockedRes as any);
    assert.equal(lockedRes.statusCode, 400);
    assert.equal(lockedRes.body?.error, "invalid_or_expired_code");
    assert.equal(db.state.sessions.length, 0);
  } finally {
    if (previousMaxAttempts === undefined) delete process.env.AUTH_OTP_MAX_ATTEMPTS;
    else process.env.AUTH_OTP_MAX_ATTEMPTS = previousMaxAttempts;
  }
});

test("consuming recent reauth is atomic and rejects replay", async () => {
  const db = createDb();
  const token = "token-for-consume";
  db.state.sessions.push({
    id: "session_1",
    userId: "user_1",
    tokenHash: sha256(token),
    expiresAt: new Date(Date.now() + 60_000)
  });
  const guard = createRecentReauthGuard(db, { consume: true });
  let nextCount = 0;

  const firstRes = createMockRes();
  await guard(
    { cookies: { [REAUTH_COOKIE]: token } } as any,
    firstRes as any,
    () => { nextCount += 1; }
  );
  assert.equal(nextCount, 1);
  assert.equal(db.state.sessions.length, 0);
  assert.equal(firstRes.clearedCookies.includes(REAUTH_COOKIE), true);

  const replayRes = createMockRes();
  await guard(
    { cookies: { [REAUTH_COOKIE]: token } } as any,
    replayRes as any,
    () => { nextCount += 1; }
  );
  assert.equal(nextCount, 1);
  assert.equal(replayRes.statusCode, 401);
  assert.equal(replayRes.body?.error, "REAUTH_REQUIRED");
});

test("recent reauth cannot be used by another authenticated user", async () => {
  const db = createDb();
  const token = "token-for-user-one";
  db.state.sessions.push({
    id: "session_1",
    userId: "user_1",
    tokenHash: sha256(token),
    expiresAt: new Date(Date.now() + 60_000)
  });
  const guard = createRecentReauthGuard(db);
  const res = createMockRes("user_2");
  let called = false;

  await guard(
    { cookies: { [REAUTH_COOKIE]: token } } as any,
    res as any,
    () => { called = true; }
  );

  assert.equal(called, false);
  assert.equal(res.statusCode, 401);
  assert.equal(res.body?.error, "REAUTH_REQUIRED");
});
