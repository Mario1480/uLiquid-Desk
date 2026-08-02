import assert from "node:assert/strict";
import test from "node:test";
import { normalizeNonNegativeBillingInteger } from "./adminPackageValues.js";

test("admin billing token values preserve integers above Number.MAX_SAFE_INTEGER", () => {
  assert.equal(
    normalizeNonNegativeBillingInteger("9007199254740993"),
    "9007199254740993"
  );
  assert.equal(normalizeNonNegativeBillingInteger("00042"), "42");
});

test("admin billing token values reject malformed and signed-64 overflow input", () => {
  assert.throws(() => normalizeNonNegativeBillingInteger(""), /billing_integer_invalid/);
  assert.throws(() => normalizeNonNegativeBillingInteger("1.5"), /billing_integer_invalid/);
  assert.throws(
    () => normalizeNonNegativeBillingInteger("9223372036854775808"),
    /billing_integer_out_of_range/
  );
});
