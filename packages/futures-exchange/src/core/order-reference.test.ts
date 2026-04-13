import assert from "node:assert/strict";
import test from "node:test";
import {
  buildOrderReferenceKey,
  buildOrderReferenceIdentity,
  canonicalizeOrderReference,
  collectOrderReferenceCandidates,
  collectCanonicalOrderReferenceKeys,
  collectOrderReferenceSet,
  normalizeCloid,
  orderReferenceInputsMatch
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

test("buildOrderReferenceKey keeps bare numeric exchange ids as order refs", () => {
  assert.equal(buildOrderReferenceKey({
    exchangeOrderId: "123"
  }), "order:123");
});

test("buildOrderReferenceIdentity canonicalizes cloid-like client ids without losing client ids", () => {
  assert.deepEqual(buildOrderReferenceIdentity({
    clientOrderId: "grid-cid-1",
    exchangeOrderId: "cloid:0:123"
  }).keys.sort(), ["client:grid-cid-1", "cloid:123"]);

  assert.deepEqual(buildOrderReferenceIdentity({
    clientOrderId: "0x7b"
  }).keys, ["cloid:123"]);
});

test("canonicalizeOrderReference treats bare numeric values as cloid only for cloid-like hints", () => {
  assert.equal(canonicalizeOrderReference("123", "exchange")?.key, "order:123");
  assert.equal(canonicalizeOrderReference("123", "cloid")?.key, "cloid:123");
  assert.equal(canonicalizeOrderReference("123", "client_or_cloid")?.key, "cloid:123");
});

test("orderReferenceInputsMatch uses the same canonical rules across client, cloid, and exchange refs", () => {
  const decimal = "208456784328589790982014142665896995042";
  const hex = `0x${BigInt(decimal).toString(16).padStart(32, "0")}`;

  assert.equal(orderReferenceInputsMatch({
    exchangeOrderId: `corewriter:7:${decimal}`
  }, {
    exchangeOrderId: `cloid:7:${decimal}`
  }), true);

  assert.equal(orderReferenceInputsMatch({
    clientOrderId: hex
  }, {
    exchangeOrderId: `cloid:0:${decimal}`
  }), true);

  assert.equal(orderReferenceInputsMatch({
    exchangeOrderId: "123"
  }, {
    clientOrderId: "123"
  }), false);
});

test("collectCanonicalOrderReferenceKeys emits typed canonical keys", () => {
  const keys = collectCanonicalOrderReferenceKeys([
    { value: "123", hint: "exchange" },
    { value: "0x7b", hint: "cloid" },
    { value: "grid-cid-1", hint: "client_or_cloid" }
  ]);

  assert.equal(keys.has("order:123"), true);
  assert.equal(keys.has("cloid:123"), true);
  assert.equal(keys.has("client:grid-cid-1"), true);
});

test("normalizeCloid normalizes decimal, cloid wrapper, and hex forms", () => {
  assert.equal(normalizeCloid("123"), "123");
  assert.equal(normalizeCloid("cloid:0:123"), "123");
  assert.equal(normalizeCloid("corewriter:0:123"), "123");
  assert.equal(normalizeCloid("0x7b"), "123");
});
