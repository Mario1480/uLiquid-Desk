import assert from "node:assert/strict";
import test from "node:test";
import { buildSiweNonceCookieOptions, createSiweService, SiweServiceError } from "./siwe.service.js";

test("buildSiweNonceCookieOptions returns httpOnly cookie defaults", () => {
  const originalSecure = process.env.COOKIE_SECURE;
  try {
    process.env.COOKIE_SECURE = "false";
    const options = buildSiweNonceCookieOptions(10_000);
    assert.equal(options.httpOnly, true);
    assert.equal(options.sameSite, "lax");
    assert.equal(options.maxAge, 10_000);
    assert.equal(options.path, "/");
    assert.equal(options.secure, false);
  } finally {
    process.env.COOKIE_SECURE = originalSecure;
  }
});

test("issueNonce creates hashed nonce/token row", async () => {
  const created: any[] = [];
  const db = {
    siweNonce: {
      async create(input: any) {
        created.push(input);
        return { id: "sn_1", ...input.data };
      }
    }
  } as any;

  const service = createSiweService(db);
  const issued = await service.issueNonce();

  assert.equal(typeof issued.nonce, "string");
  assert.equal(typeof issued.token, "string");
  assert.ok(issued.nonce.length >= 8);
  assert.ok(issued.token.length >= 16);
  assert.equal(created.length, 1);
  assert.notEqual(created[0].data.nonceHash, issued.nonce);
  assert.notEqual(created[0].data.tokenHash, issued.token);
});

test("verify rejects when nonce cookie is missing", async () => {
  const db = {
    siweNonce: {
      async findUnique() {
        return null;
      },
      async updateMany() {
        return { count: 0 };
      }
    }
  } as any;

  const service = createSiweService(db);

  await assert.rejects(
    () =>
      service.verify({
        message: "example.org wants you to sign in with your Ethereum account:\n0x1111111111111111111111111111111111111111\n\nSign in\n\nURI: http://example.org\nVersion: 1\nChain ID: 999\nNonce: testnonce\nIssued At: 2026-03-06T10:00:00.000Z",
        signature: "0xdeadbeef",
        nonceToken: "",
        requestHost: "example.org"
      }),
    (error: unknown) => {
      assert.ok(error instanceof SiweServiceError);
      assert.equal((error as SiweServiceError).code, "siwe_nonce_missing");
      return true;
    }
  );
});
