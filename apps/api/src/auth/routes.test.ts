import assert from "node:assert/strict";
import test from "node:test";
import { SESSION_COOKIE, SIWE_NONCE_COOKIE } from "./cookies.js";
import { buildOtpFailureUpdate, isRegistrationHoneypotTriggered, registerAuthRoutes } from "./routes.js";
import { resetLoginFailureMemoryForTests } from "./loginProtection.js";
import { TurnstileError } from "./turnstileSecurity.js";

test("registration honeypot only triggers for non-empty text", () => {
  assert.equal(isRegistrationHoneypotTriggered(undefined), false);
  assert.equal(isRegistrationHoneypotTriggered(""), false);
  assert.equal(isRegistrationHoneypotTriggered("   "), false);
  assert.equal(isRegistrationHoneypotTriggered("https://spam.example"), true);
});

test("registration honeypot returns generically without creating user, workspace, OTP, or email", async () => {
  const postRoutes = new Map<string, Array<(...args: any[]) => any>>();
  const app = {
    post(path: string, ...handlers: Array<(...args: any[]) => any>) {
      postRoutes.set(path, handlers);
    },
    get() {
      return undefined;
    }
  };
  const calls = { user: 0, workspace: 0, otp: 0, email: 0 };
  registerAuthRoutes(app as any, {
    db: {
      globalSetting: { findUnique: async () => null },
      user: { findUnique: async () => { calls.user += 1; return null; } },
      reauthOtp: { create: async () => { calls.otp += 1; } }
    },
    registerSchema: {
      safeParse: () => ({
        success: true,
        data: {
          email: "bot@example.com",
          password: "password123",
          companyWebsite: "https://spam.example"
        }
      })
    },
    ensureWorkspaceMembership: async () => { calls.workspace += 1; },
    sendEmailVerificationOtpEmail: async () => { calls.email += 1; return { ok: true }; },
    EMAIL_VERIFICATION_OTP_TTL_MIN: 15
  } as any);

  const handler = postRoutes.get("/auth/register")?.at(-1);
  assert.ok(handler);
  const res: any = {
    locals: {},
    statusCode: 200,
    status(code: number) { this.statusCode = code; return this; },
    json(payload: unknown) { this.body = payload; return this; }
  };
  await handler({ body: {}, ip: "127.0.0.1", headers: {} } as any, res);

  assert.equal(res.statusCode, 201);
  assert.equal(res.body?.pendingVerification, true);
  assert.deepEqual(calls, { user: 0, workspace: 0, otp: 0, email: 0 });
});

test("buildOtpFailureUpdate locks OTP after the configured failed attempt threshold", () => {
  const expiresAt = new Date("2026-05-02T12:00:00.000Z");

  assert.deepEqual(buildOtpFailureUpdate({ attemptCount: 3, expiresAt }, 5), {
    attemptCount: { increment: 1 },
    lockedUntil: null
  });
  assert.deepEqual(buildOtpFailureUpdate({ attemptCount: 4, expiresAt }, 5), {
    attemptCount: { increment: 1 },
    lockedUntil: expiresAt
  });
});

test("registration, verification resend and reset email require their exact Turnstile actions", async () => {
  const postRoutes = new Map<string, Array<(...args: any[]) => any>>();
  const actions: string[] = [];
  const app = {
    post(path: string, ...handlers: Array<(...args: any[]) => any>) { postRoutes.set(path, handlers); },
    get() { return undefined; }
  };
  const schema = (data: Record<string, unknown>) => ({ safeParse: () => ({ success: true, data }) });
  registerAuthRoutes(app as any, {
    db: { globalSetting: { findUnique: async () => null } },
    registerSchema: schema({ email: "user@example.com", password: "password123", companyWebsite: "", turnstileToken: "token" }),
    registerResendSchema: schema({ email: "user@example.com", turnstileToken: "token" }),
    passwordResetRequestSchema: schema({ email: "user@example.com", turnstileToken: "token" }),
    verifyTurnstile: async (_token: string, action: string) => {
      actions.push(action);
      throw new TurnstileError("turnstile_invalid", 400);
    }
  } as any);

  const response = () => ({
    locals: {},
    statusCode: 200,
    status(code: number) { this.statusCode = code; return this; },
    json(payload: unknown) { (this as any).body = payload; return this; }
  });
  for (const path of ["/auth/register", "/auth/register/resend", "/auth/password-reset/request"]) {
    const handler = postRoutes.get(path)?.at(-1);
    assert.ok(handler);
    await handler({ body: {}, ip: "127.0.0.1", headers: {} } as any, response() as any);
  }
  assert.deepEqual(actions, ["signup", "signup_resend", "password_reset"]);
});

test("email login adds a Turnstile step-up after repeated failures", async () => {
  resetLoginFailureMemoryForTests();
  const postRoutes = new Map<string, Array<(...args: any[]) => any>>();
  const actions: string[] = [];
  const app = {
    post(path: string, ...handlers: Array<(...args: any[]) => any>) { postRoutes.set(path, handlers); },
    get() { return undefined; }
  };
  registerAuthRoutes(app as any, {
    db: { user: { findUnique: async () => null } },
    loginSchema: { safeParse: (body: any) => ({ success: true, data: body }) },
    verifyTurnstile: async (_token: string, action: string) => { actions.push(action); }
  } as any);
  const handler = postRoutes.get("/auth/login")?.at(-1);
  assert.ok(handler);
  const invoke = async (turnstileToken?: string) => {
    const res: any = {
      locals: {}, statusCode: 200,
      status(code: number) { this.statusCode = code; return this; },
      json(payload: unknown) { this.body = payload; return this; }
    };
    await handler({ body: { email: "user@example.com", password: "wrong", turnstileToken }, ip: "127.0.0.2", headers: {} } as any, res);
    return res;
  };

  assert.equal((await invoke()).statusCode, 401);
  assert.equal((await invoke()).body.turnstileRequired, true);
  const challenged = await invoke();
  assert.equal(challenged.statusCode, 403);
  assert.equal(challenged.body.error, "turnstile_required");
  assert.equal((await invoke("token")).statusCode, 401);
  assert.deepEqual(actions, ["login"]);
});

test("logout revokes outstanding reauth sessions", async () => {
  const postRoutes = new Map<string, Array<(...args: any[]) => any>>();
  const app = {
    post(path: string, ...handlers: Array<(...args: any[]) => any>) {
      postRoutes.set(path, handlers);
    },
    get() {
      return undefined;
    }
  };
  let destroyedToken: string | null = null;
  let revokedUserId: string | null = null;
  const deps: any = {
    db: {
      session: {
        findUnique: async () => ({ id: "session_1", userId: "user_1" })
      },
      reauthSession: {
        deleteMany: async ({ where }: any) => {
          revokedUserId = where.userId;
          return { count: 1 };
        }
      },
      workspaceMember: {
        findFirst: async () => null
      }
    },
    destroySession: async (_res: unknown, token: string | null) => {
      destroyedToken = token;
    }
  };
  registerAuthRoutes(app as any, deps);
  const handler = postRoutes.get("/auth/logout")?.at(-1);
  assert.ok(handler);
  const cleared: string[] = [];
  const res: any = {
    locals: {},
    clearCookie(name: string) {
      cleared.push(name);
      return this;
    },
    json(payload: unknown) {
      this.body = payload;
      return this;
    }
  };

  await handler({ cookies: { [SESSION_COOKIE]: "session-token" } } as any, res);

  assert.equal(destroyedToken, "session-token");
  assert.equal(revokedUserId, "user_1");
  assert.equal(res.body?.ok, true);
  assert.equal(cleared.includes(SIWE_NONCE_COOKIE), true);
});
