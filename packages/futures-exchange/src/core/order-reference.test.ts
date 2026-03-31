import assert from "node:assert/strict";
import test from "node:test";
import {
  buildOrderReferenceKey,
  collectOrderReferenceCandidates,
  collectOrderReferenceSet,
  normalizeCloid
} from "./order-reference.js";

test("collectOrderReferenceCandidates expands cloid strings into decimal and hex fingerprints", () => {
  const decimal = "208456784328589790982014142665896995042";
  const expectedHex = `0x${BigInt(decimal).toString(16).padStart(32, "0")}`;
  const refs = collectOrderReferenceCandidates(`cloid:0:${decimal}`);

  assert.ok(refs.includes(`cloid:0:${decimal}`));
  assert.ok(refs.includes(decimal));
  assert.ok(refs.includes(expectedHex));
});

test("collectOrderReferenceCandidates keeps legacy corewriter refs compatible with canonical cloid refs", () => {
  const decimal = "208456784328589790982014142665896995042";
  const expectedHex = `0x${BigInt(decimal).toString(16).padStart(32, "0")}`;
  const refs = collectOrderReferenceCandidates(`corewriter:7:${decimal}`);

  assert.ok(refs.includes(`corewriter:7:${decimal}`));
  assert.ok(refs.includes(`cloid:7:${decimal}`));
  assert.ok(refs.includes(decimal));
  assert.ok(refs.includes(expectedHex));
});

test("collectOrderReferenceCandidates expands hex cloid values back to decimal", () => {
  const decimal = "208456784328589790982014142665896995042";
  const expectedHex = `0x${BigInt(decimal).toString(16).padStart(32, "0")}`;
  const refs = collectOrderReferenceCandidates(expectedHex);

  assert.ok(refs.includes(expectedHex));
  assert.ok(refs.includes(decimal));
});

test("collectOrderReferenceSet dedupes mixed order references", () => {
  const decimal = "208456784328589790982014142665896995042";
  const expectedHex = `0x${BigInt(decimal).toString(16).padStart(32, "0")}`;
  const refs = collectOrderReferenceSet([
    `cloid:0:${decimal}`,
    expectedHex
  ]);

  assert.equal(refs.has(decimal), true);
  assert.equal(refs.has(expectedHex), true);
});

test("buildOrderReferenceKey prefers client id, then normalized cloid, then raw order id", () => {
  assert.equal(buildOrderReferenceKey({
    clientOrderId: "grid-cid-1",
    exchangeOrderId: "cloid:0:123"
  }), "client:grid-cid-1");

  assert.equal(buildOrderReferenceKey({
    exchangeOrderId: "cloid:0:123"
  }), "cloid:123");

  assert.equal(buildOrderReferenceKey({
    exchangeOrderId: "venue-123"
  }), "order:venue-123");
});

test("normalizeCloid normalizes decimal, cloid wrapper, and hex forms", () => {
  assert.equal(normalizeCloid("123"), "123");
  assert.equal(normalizeCloid("cloid:0:123"), "123");
  assert.equal(normalizeCloid("corewriter:0:123"), "123");
  assert.equal(normalizeCloid("0x7b"), "123");
});
