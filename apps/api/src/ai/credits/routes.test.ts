import test from "node:test";
import assert from "node:assert/strict";
import { decodeAiUsageCursor, encodeAiUsageCursor } from "./routes.js";

test("AI usage cursors preserve the stable createdAt and id boundary", () => {
  const cursor = {
    id: "run_01",
    createdAt: "2026-08-21T07:30:00.000Z"
  };

  assert.deepEqual(decodeAiUsageCursor(encodeAiUsageCursor(cursor)), cursor);
});

test("AI usage cursors reject malformed or incomplete values", () => {
  assert.throws(() => decodeAiUsageCursor("not-a-valid-cursor"), /invalid_cursor/);
  const incomplete = Buffer.from(JSON.stringify({ id: "run_01" }), "utf8").toString("base64url");
  assert.throws(() => decodeAiUsageCursor(incomplete), /invalid_cursor/);
});
