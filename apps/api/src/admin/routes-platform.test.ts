import assert from "node:assert/strict";
import test from "node:test";
import { formatPlatformAlertMessage, registerPlatformAdminRoutes } from "./routes-platform.js";

type RouteMap = Map<string, Array<(...args: any[]) => any>>;

function createFakeApp() {
  const routes = {
    get: new Map() as RouteMap,
    post: new Map() as RouteMap,
    put: new Map() as RouteMap
  };
  return {
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

function createMockRes() {
  return {
    locals: {
      user: {
        id: "admin_1",
        email: "admin@example.com",
        isSuperadmin: true
      }
    },
    req: { ip: "127.0.0.1" },
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

function createDeps(overrides: Partial<Parameters<typeof registerPlatformAdminRoutes>[1]> = {}) {
  return {
    db: {},
    requirePlatformSuperadmin: async () => true,
    recordAdminAuditEvent: async () => {},
    readUserFromLocals: (res: any) => res.locals.user,
    isSuperadminEmail: (email: string) => email.trim().toLowerCase() === "admin@example.com",
    getAdminBackendAccessUserIdSet: async () => new Set<string>(),
    getAccessSectionSettings: async () => ({}),
    getServerInfoSettings: async () => ({}),
    getBillingFeatureFlagsSettings: async () => ({}),
    ...overrides
  };
}

function getFinalHandler(app: ReturnType<typeof createFakeApp>, path: string) {
  const handlers = app.routes.get.get(path);
  if (!handlers || handlers.length === 0) throw new Error(`route_not_found:${path}`);
  return handlers[handlers.length - 1];
}

test("formatPlatformAlertMessage makes legacy recovered health incidents explicit", () => {
  assert.equal(
    formatPlatformAlertMessage({
      type: "system_health",
      status: "resolved",
      message: "10 providers/sources checked; 0 unavailable; 0 degraded."
    }),
    "Recovered: 10 providers/sources checked; 0 unavailable; 0 degraded. Original incident details were not retained by the legacy monitor."
  );
});

test("formatPlatformAlertMessage preserves new recovery messages with incident context", () => {
  const message = "Recovered: 10 providers/sources checked; 0 unavailable; 0 degraded. Previous incident: calendar source unavailable.";
  assert.equal(
    formatPlatformAlertMessage({ type: "system_health", status: "resolved", message }),
    message
  );
});

test("GET /admin/users applies filters and pagination in Prisma queries", async () => {
  const app = createFakeApp();
  let countArgs: any = null;
  let findManyArgs: any = null;
  const previousAdminEmail = process.env.ADMIN_EMAIL;
  process.env.ADMIN_EMAIL = "admin@example.com,second@example.com";
  try {
    registerPlatformAdminRoutes(app as any, createDeps({
      db: {
        user: {
          async count(args: any) {
            countArgs = args;
            return 42;
          },
          async findMany(args: any) {
            findManyArgs = args;
            return [{
              id: "admin_1",
              email: "admin@example.com",
              createdAt: new Date("2026-01-01T00:00:00.000Z"),
              updatedAt: new Date("2026-01-02T00:00:00.000Z"),
              sessions: [{
                createdAt: new Date("2026-01-03T00:00:00.000Z"),
                lastActiveAt: new Date()
              }],
              workspaces: [],
              subscription: null,
              _count: { workspaces: 0, bots: 0, sessions: 1 }
            }];
          }
        }
      }
    } as any));

    const handler = getFinalHandler(app, "/admin/users");
    const res = createMockRes();
    await handler({
      query: {
        page: "2",
        pageSize: "5",
        search: "admin",
        status: "active",
        role: "Superadmin",
        licenseStatus: "inactive"
      }
    }, res);

    assert.equal(res.statusCode, 200);
    assert.equal(findManyArgs.skip, 5);
    assert.equal(findManyArgs.take, 5);
    assert.deepEqual(countArgs.where, findManyArgs.where);
    assert.match(JSON.stringify(findManyArgs.where), /admin@example\.com/);
    assert.equal(res.body.pagination.total, 42);
    assert.equal(res.body.items[0].role, "Superadmin");
  } finally {
    if (previousAdminEmail === undefined) delete process.env.ADMIN_EMAIL;
    else process.env.ADMIN_EMAIL = previousAdminEmail;
  }
});

test("GET /admin/workspaces counts and loads bot summaries only for the current page", async () => {
  const app = createFakeApp();
  let workspaceFindArgs: any = null;
  let botFindArgs: any = null;
  registerPlatformAdminRoutes(app as any, createDeps({
    db: {
      workspace: {
        async count() {
          return 15;
        },
        async findMany(args: any) {
          workspaceFindArgs = args;
          return [{
            id: "ws_page",
            name: "Workspace Page",
            createdAt: new Date("2026-01-01T00:00:00.000Z"),
            licenseEntitlement: { plan: "pro" },
            _count: { members: 2, bots: 3 }
          }];
        }
      },
      workspaceMember: {
        async findMany() {
          return [];
        }
      },
      bot: {
        async findMany(args: any) {
          botFindArgs = args;
          return [{
            workspaceId: "ws_page",
            status: "running",
            updatedAt: new Date("2026-01-05T00:00:00.000Z")
          }];
        }
      }
    }
  } as any));

  const handler = getFinalHandler(app, "/admin/workspaces");
  const res = createMockRes();
  await handler({
    query: {
      page: "3",
      pageSize: "7",
      status: "active",
      licenseStatus: "active"
    }
  }, res);

  assert.equal(workspaceFindArgs.skip, 14);
  assert.equal(workspaceFindArgs.take, 7);
  assert.deepEqual(botFindArgs.where, { workspaceId: { in: ["ws_page"] } });
  assert.equal(res.body.pagination.total, 15);
  assert.equal(res.body.items[0].status, "active");
});

test("GET /admin/bots translates strategy filtering into the DB query", async () => {
  const app = createFakeApp();
  let countArgs: any = null;
  let findManyArgs: any = null;
  registerPlatformAdminRoutes(app as any, createDeps({
    db: {
      bot: {
        async count(args: any) {
          countArgs = args;
          return 3;
        },
        async findMany(args: any) {
          findManyArgs = args;
          return [{
            id: "bot_1",
            name: "Grid Bot",
            symbol: "BTCUSDT",
            exchange: "binance",
            status: "running",
            lastError: null,
            createdAt: new Date("2026-01-01T00:00:00.000Z"),
            workspace: null,
            user: null,
            runtime: null,
            futuresConfig: null,
            gridInstance: { id: "grid_1" }
          }];
        }
      }
    }
  } as any));

  const handler = getFinalHandler(app, "/admin/bots");
  const res = createMockRes();
  await handler({ query: { strategyType: "grid", pageSize: "10" } }, res);

  assert.deepEqual(countArgs.where, { gridInstance: { isNot: null } });
  assert.deepEqual(findManyArgs.where, countArgs.where);
  assert.equal(findManyArgs.skip, 0);
  assert.equal(findManyArgs.take, 10);
  assert.equal(res.body.items[0].strategyType, "grid");
});

test("GET /admin/runners loads runtime joins only for paged runner IDs", async () => {
  const app = createFakeApp();
  let runnerFindArgs: any = null;
  const runtimeFindCalls: any[] = [];
  registerPlatformAdminRoutes(app as any, createDeps({
    db: {
      runnerNode: {
        async count() {
          return 2;
        },
        async findMany(args: any) {
          runnerFindArgs = args;
          return [{
            id: "runner_2",
            name: "Runner 2",
            status: "unknown",
            lastHeartbeatAt: null,
            version: "1.0.0",
            region: "eu",
            host: "host-2",
            metadata: null
          }];
        }
      },
      botRuntime: {
        async findMany(args: any) {
          runtimeFindCalls.push(args);
          return [{
            workerId: "runner_2",
            status: "running",
            lastHeartbeatAt: new Date(),
            lastTickAt: new Date(),
            updatedAt: new Date()
          }];
        }
      }
    }
  } as any));

  const handler = getFinalHandler(app, "/admin/runners");
  const res = createMockRes();
  await handler({ query: { page: "2", pageSize: "1" } }, res);

  assert.equal(runnerFindArgs.skip, 1);
  assert.equal(runnerFindArgs.take, 1);
  assert.equal(runtimeFindCalls.length, 1);
  assert.deepEqual(runtimeFindCalls[0].where, { workerId: { in: ["runner_2"] } });
  assert.equal(res.body.pagination.total, 2);
  assert.equal(res.body.items[0].assignedBotsCount, 1);
});
