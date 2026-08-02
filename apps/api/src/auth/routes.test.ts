import assert from "node:assert/strict";
import test from "node:test";
import { buildOtpFailureUpdate, registerAuthRoutes } from "./routes.js";

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

  await handler({ cookies: { mm_session: "session-token" } } as any, res);

  assert.equal(destroyedToken, "session-token");
  assert.equal(revokedUserId, "user_1");
  assert.equal(res.body?.ok, true);
  assert.equal(cleared.includes("mm_siwe_nonce"), true);
});
