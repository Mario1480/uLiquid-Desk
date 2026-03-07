import assert from "node:assert/strict";
import test from "node:test";
import { hashStable } from "./hashing.js";

test("hashStable is deterministic for object key order", () => {
  const a = {
    b: 2,
    a: 1,
    nested: {
      y: "v",
      x: "u"
    }
  };
  const b = {
    nested: {
      x: "u",
      y: "v"
    },
    a: 1,
    b: 2
  };
  assert.equal(hashStable(a), hashStable(b));
});

