import assert from "node:assert/strict";
import test from "node:test";
import {
  clearAuthCookieOptions,
  csrfCookieOptions,
  sessionCookieOptions
} from "./cookies.js";

test("auth cookies are httpOnly for sessions and readable only for csrf", () => {
  const session = sessionCookieOptions(60_000);
  const csrf = csrfCookieOptions(60_000);

  assert.equal(session.httpOnly, true);
  assert.equal(csrf.httpOnly, false);
  assert.equal(session.sameSite, "lax");
  assert.equal(csrf.sameSite, "lax");
  assert.equal(session.path, "/");
  assert.equal(csrf.path, "/");
});

test("auth cookie secure flag follows production defaults and explicit override", () => {
  const previousNodeEnv = process.env.NODE_ENV;
  const previousCookieSecure = process.env.COOKIE_SECURE;

  try {
    process.env.NODE_ENV = "production";
    delete process.env.COOKIE_SECURE;
    assert.equal(sessionCookieOptions(60_000).secure, true);

    process.env.NODE_ENV = "development";
    process.env.COOKIE_SECURE = "true";
    assert.equal(sessionCookieOptions(60_000).secure, true);
  } finally {
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousNodeEnv;
    if (previousCookieSecure === undefined) delete process.env.COOKIE_SECURE;
    else process.env.COOKIE_SECURE = previousCookieSecure;
  }
});
test("clear auth cookie options preserve configured domain", () => {
  const previous = process.env.COOKIE_DOMAIN;
  try {
    process.env.COOKIE_DOMAIN = ".example.com";
    assert.deepEqual(clearAuthCookieOptions(), { path: "/", domain: ".example.com" });
  } finally {
    if (previous === undefined) delete process.env.COOKIE_DOMAIN;
    else process.env.COOKIE_DOMAIN = previous;
  }
});
