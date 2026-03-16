import assert from "node:assert/strict";
import test from "node:test";
import { SiweMessage } from "siwe";
import { buildSiweMessage } from "./siwe.js";

test("buildSiweMessage normalizes localized statement text to a parsable SIWE message", () => {
  const message = buildSiweMessage({
    domain: "desk.uliquid.vip",
    address: "0x1111111111111111111111111111111111111111",
    uri: "https://desk.uliquid.vip",
    chainId: 999,
    nonce: "abcdef12",
    issuedAt: "2026-03-11T10:00:00.000Z",
    statement: "Wallet mit uLiquid Desk-Konto verknüpfen"
  });

  const parsed = new SiweMessage(message);
  assert.equal(parsed.domain, "desk.uliquid.vip");
  assert.equal(parsed.uri, "https://desk.uliquid.vip");
  assert.equal(parsed.statement, "Wallet mit uLiquid Desk-Konto verknupfen");
});
