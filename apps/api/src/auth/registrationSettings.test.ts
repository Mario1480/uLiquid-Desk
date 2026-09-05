import assert from "node:assert/strict";
import test from "node:test";
import { readRegistrationSettings, registerRegistrationSettingsRoutes } from "./registrationSettings.js";
import { registerAuthRoutes } from "./routes.js";

function response() {
  return {
    locals: { user: { id: "admin", email: "admin@example.test" } },
    statusCode: 200, body: null as any,
    setHeader() {},
    status(code: number) { this.statusCode = code; return this; },
    json(body: any) { this.body = body; return this; }
  };
}

function appMock() {
  const routes = new Map<string, any[]>();
  return {
    routes,
    get(path: string, ...handlers: any[]) { routes.set(`GET ${path}`, handlers); },
    post(path: string, ...handlers: any[]) { routes.set(`POST ${path}`, handlers); },
    put(path: string, ...handlers: any[]) { routes.set(`PUT ${path}`, handlers); }
  };
}

test("registration defaults to open only when no setting exists; malformed values close registration", async () => {
  for (const [value, expected] of [[undefined, true], [{ enabled: true }, true], [{ enabled: false }, false], [{ enabled: "true" }, false]] as const) {
    const db = { globalSetting: { findUnique: async () => value === undefined ? null : { value } } };
    assert.equal((await readRegistrationSettings(db)).enabled, expected);
  }
});

test("disabled registration blocks direct requests before validation or any signup side effects", async () => {
  const app = appMock();
  registerAuthRoutes(app as any, {
    db: { globalSetting: { findUnique: async () => ({ value: { enabled: false } }) } },
    registerSchema: { safeParse() { assert.fail("registration must stop before validation"); } }
  } as any);
  const res = response();
  await app.routes.get("POST /auth/register")!.at(-1)({ body: {} }, res);
  assert.equal(res.statusCode, 403);
  assert.equal(res.body.error, "registration_disabled");
  assert.ok(app.routes.has("POST /auth/login"));
});

test("registration fails closed on a setting read failure", async () => {
  const app = appMock();
  registerAuthRoutes(app as any, {
    db: { globalSetting: { findUnique: async () => { throw new Error("offline"); } } }
  } as any);
  const res = response();
  await app.routes.get("POST /auth/register")!.at(-1)({ body: {} }, res);
  assert.equal(res.statusCode, 503);
  assert.equal(res.body.error, "registration_unavailable");
});

test("admin setting requires authorization, validates booleans, and audits changes atomically", async () => {
  const app = appMock();
  let allowed = false;
  let stored: any = null;
  let audit: any = null;
  let writes = 0;
  const tx = { globalSetting: { upsert: async (input: any) => { stored = input.update.value; writes++; } } };
  registerRegistrationSettingsRoutes(app as any, {
    db: { $transaction: async (fn: any) => fn(tx), globalSetting: { findUnique: async () => stored ? { value: stored } : null } },
    requireSuperadmin: async (res) => { if (!allowed) res.status(403).json({ error: "forbidden" }); return allowed; },
    recordAdminAuditEvent: async (input) => { audit = input; }
  });
  const put = app.routes.get("PUT /admin/settings/registration")!;
  assert.equal(put.length, 2, "authentication middleware must precede the handler");
  let res = response();
  await put.at(-1)({ body: { enabled: false } }, res);
  assert.equal(res.statusCode, 403);
  assert.equal(writes, 0);
  allowed = true;
  res = response();
  await put.at(-1)({ body: { enabled: "false" } }, res);
  assert.equal(res.statusCode, 400);
  assert.equal(writes, 0);
  for (const enabled of [false, true]) {
    res = response();
    await put.at(-1)({ body: { enabled }, ip: "127.0.0.1" }, res);
    assert.deepEqual(res.body, { enabled });
    assert.equal(audit.tx, tx);
    assert.equal(audit.action, "admin.registration.updated");
    const publicRes = response();
    await app.routes.get("GET /auth/registration")!.at(-1)({}, publicRes);
    assert.deepEqual(publicRes.body, { enabled });
  }
});
