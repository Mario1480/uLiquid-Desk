import assert from "node:assert/strict";
import test from "node:test";
import {
  sanitizeMobileInput,
  standardizeMobileErrorResponses
} from "./security.js";

function createReqRes() {
  const req: any = { method: "GET", originalUrl: "/mobile/dashboard" };
  const res: any = {
    locals: {
      requestId: "req_1",
      correlationId: "corr_1"
    },
    statusCode: 400,
    json(payload: unknown) {
      res.body = payload;
      return res;
    }
  };
  return { req, res };
}

test("sanitizeMobileInput trims strings and removes control characters recursively", () => {
  assert.deepEqual(
    sanitizeMobileInput({
      " symbol\u0000 ": " BTCUSDT\u0007 ",
      nested: [" ok\t ", { q: " hello\u001F " }]
    }),
    {
      symbol: "BTCUSDT",
      nested: ["ok", { q: "hello" }]
    }
  );
});

test("standardizeMobileErrorResponses preserves top-level error code and adds trace ids", () => {
  const { req, res } = createReqRes();
  let nextCalled = false;
  standardizeMobileErrorResponses(req as any, res as any, () => {
    nextCalled = true;
  });
  res.json({ error: "invalid_payload", details: { fieldErrors: {} } });

  assert.equal(nextCalled, true);
  assert.equal(res.body.error, "invalid_payload");
  assert.equal(res.body.message, "invalid_payload");
  assert.equal(res.body.ok, false);
  assert.equal(res.body.requestId, "req_1");
  assert.equal(res.body.correlationId, "corr_1");
});
