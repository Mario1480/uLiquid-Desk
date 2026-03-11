import assert from "node:assert/strict";
import test from "node:test";
import { SiweMessage } from "siwe";
import { buildSiweMessage } from "./siwe.js";

test("buildSiweMessage normalizes localized statement text to a parsable SIWE message", () => {
  const message = buildSiweMessage({
    domain: "panel.utrade.vip",
    address: "0x1111111111111111111111111111111111111111",
    uri: "https://panel.utrade.vip",
    chainId: 999,
    nonce: "abcdef12",
    issuedAt: "2026-03-11T10:00:00.000Z",
    statement: "Wallet mit uTrade-Konto verknüpfen"
  });

  const parsed = new SiweMessage(message);
  assert.equal(parsed.domain, "panel.utrade.vip");
  assert.equal(parsed.uri, "https://panel.utrade.vip");
  assert.equal(parsed.statement, "Wallet mit uTrade-Konto verknupfen");
});
