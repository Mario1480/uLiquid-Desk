import assert from "node:assert/strict";
import test from "node:test";
import { registerUliqPublicPresaleRoutes } from "./publicPresale.routes.js";

test("public snapshots coalesce concurrent reads and retry failed requests", async () => {
  const previous = process.env.ULIQ_PUBLIC_PRESALE_ENABLED;
  process.env.ULIQ_PUBLIC_PRESALE_ENABLED = "true";
  try {
    const handlers = new Map<string, any>();
    const app = { get(path: string, ...args: any[]) { handlers.set(path, args.at(-1)); }, post() {}, delete() {} };
    let calls = 0;
    let finish!: (value: any) => void;
    const service = { getOverview() {
      calls++;
      if (calls === 1) return Promise.reject(new Error("rpc_unavailable"));
      return new Promise((resolve) => { finish = resolve; });
    } };
    registerUliqPublicPresaleRoutes(app as any, { service, sessionService: {}, siweService: {} } as any);
    const response = () => ({ statusCode: 200, body: null as any, status(code: number) { this.statusCode = code; return this; }, json(value: any) { this.body = value; return this; } });
    const handler = handlers.get("/uliq/public/presale");
    const failed = response();
    await handler({}, failed);
    assert.equal(failed.statusCode, 503);
    const first = response();
    const second = response();
    const requests = [handler({}, first), handler({}, second)];
    assert.equal(calls, 2);
    finish({ asOfBlock: "123" });
    await Promise.all(requests);
    assert.deepEqual(first.body, second.body);
    const cached = response();
    await handler({}, cached);
    assert.equal(calls, 2);
    assert.deepEqual(cached.body, first.body);
  } finally {
    if (previous === undefined) delete process.env.ULIQ_PUBLIC_PRESALE_ENABLED;
    else process.env.ULIQ_PUBLIC_PRESALE_ENABLED = previous;
  }
});
