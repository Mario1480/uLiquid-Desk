import assert from "node:assert/strict";
import test from "node:test";
import { registerMobilePushRoutes } from "./pushRoutes.js";

type RouteMap = Map<string, Array<(...args: any[]) => any>>;

function createFakeApp() {
  const getRoutes: RouteMap = new Map();
  const postRoutes: RouteMap = new Map();
  return {
    get(path: string, ...handlers: Array<(...args: any[]) => any>) {
      getRoutes.set(path, handlers);
    },
    post(path: string, ...handlers: Array<(...args: any[]) => any>) {
      postRoutes.set(path, handlers);
    },
    routes: {
      get: getRoutes,
      post: postRoutes
    }
  };
}

function createMockRes() {
  return {
    locals: {
      user: {
        id: "user_1",
        email: "user_1@example.com"
      }
    },
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

function getFinalHandler(app: ReturnType<typeof createFakeApp>, method: "get" | "post", path: string) {
  const handlers = app.routes[method].get(path);
  if (!handlers || handlers.length === 0) {
    throw new Error(`route_not_found:${method}:${path}`);
  }
  return handlers[handlers.length - 1];
}

function createDeps(overrides: Record<string, any> = {}) {
  const rows: any[] = [];
  const db = {
    mobilePushToken: {
      async findMany() {
        return rows;
      },
      async findUnique(args: any) {
        return rows.find((row) => row.tokenHash === args.where.tokenHash) ?? null;
      },
      async create(args: any) {
        const row = {
          id: `tok_${rows.length + 1}`,
          createdAt: new Date("2026-05-08T12:00:00.000Z"),
          ...args.data
        };
        rows.push(row);
        return row;
      },
      async update(args: any) {
        const index = rows.findIndex((row) => row.id === args.where.id);
        rows[index] = { ...rows[index], ...args.data };
        return rows[index];
      },
      async updateMany(args: any) {
        let count = 0;
        for (const row of rows) {
          if (args.where.userId && row.userId !== args.where.userId) continue;
          if (args.where.tokenHash && row.tokenHash !== args.where.tokenHash) continue;
          if (args.where.deviceId && row.deviceId !== args.where.deviceId) continue;
          if (Object.prototype.hasOwnProperty.call(args.where, "revokedAt") && row.revokedAt !== args.where.revokedAt) continue;
          Object.assign(row, args.data);
          count += 1;
        }
        return { count };
      }
    }
  };
  return {
    rows,
    db,
    authMiddleware: (_req: any, _res: any, next: any) => next(),
    getNotificationPluginSettingsForUser: async () => ({
      version: 1,
      enabled: ["core.notification.telegram"],
      disabled: [],
      order: ["core.notification.telegram"]
    }),
    updateNotificationPluginSettingsForUser: async ({ patch }: any) => patch,
    ...overrides
  };
}

test("mobile push status can be guarded by auth middleware", async () => {
  const app = createFakeApp();
  registerMobilePushRoutes(app as any, createDeps({
    authMiddleware: (_req: any, res: any) => res.status(401).json({ error: "unauthorized" })
  }) as any);

  const handler = app.routes.get.get("/mobile/push-status")?.[0];
  const res = createMockRes();
  await handler?.({}, res, () => {
    throw new Error("next_should_not_run");
  });

  assert.equal(res.statusCode, 401);
  assert.equal(res.body?.error, "unauthorized");
});

test("mobile push token registration normalizes token and enables apns plugin", async () => {
  const app = createFakeApp();
  let patch: any = null;
  const deps = createDeps({
    updateNotificationPluginSettingsForUser: async (input: any) => {
      patch = input.patch;
      return patch;
    }
  });
  registerMobilePushRoutes(app as any, deps as any);
  const handler = getFinalHandler(app, "post", "/mobile/push-tokens");
  const res = createMockRes();

  await handler({
    body: {
      token: "<AAAAAAAA AAAAAAAA AAAAAAAA AAAAAAAA>",
      environment: "sandbox",
      bundleId: "de.marioeuchner.uliquid.monitor",
      deviceId: "device_1",
      appVersion: "0.1.0"
    }
  }, res);

  assert.equal(res.statusCode, 201);
  assert.equal(deps.rows[0]?.token, "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
  assert.equal(deps.rows[0]?.environment, "sandbox");
  assert.equal(patch.enabled.includes("core.notification.apns"), true);
  assert.equal(patch.order.includes("core.notification.apns"), true);
});

test("mobile push unregister revokes matching device token", async () => {
  const app = createFakeApp();
  const deps = createDeps();
  deps.rows.push({
    id: "tok_1",
    userId: "user_1",
    tokenHash: "hash",
    token: "a".repeat(64),
    deviceId: "device_1",
    enabled: true,
    revokedAt: null
  });
  registerMobilePushRoutes(app as any, deps as any);
  const handler = getFinalHandler(app, "post", "/mobile/push-tokens/unregister");
  const res = createMockRes();

  await handler({ body: { deviceId: "device_1" } }, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body?.revoked, 1);
  assert.equal(deps.rows[0]?.enabled, false);
  assert.ok(deps.rows[0]?.revokedAt instanceof Date);
});
