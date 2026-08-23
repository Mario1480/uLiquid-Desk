# Staging auth cookie namespace fix

Date: 2026-08-23

## Problem evidence

- Staging password authentication succeeded server-side and created a session.
- The authenticated app worked in Chrome incognito but looped back to login in the
  normal profile.
- Production and staging used the same `mm_*` cookie names below overlapping parent
  domains, allowing a production cookie to shadow the staging session.

## Implemented fix

- Added the public environment setting `NEXT_PUBLIC_AUTH_COOKIE_PREFIX` with the
  backward-compatible default `mm`.
- Derived session, CSRF, reauthentication, and SIWE nonce cookie names from the same
  validated prefix.
- Replaced direct `mm_session` reads in the Next.js proxy, WebSocket authentication,
  traffic-control keys, and mobile anonymous rate limiting.
- Updated the browser API client to read the namespaced CSRF cookie.
- Passed the prefix into the production web build and documented the required web
  rebuild when the value changes.
- Preserved sibling cookies: the migration does not clear or alter production browser
  state.

## Local verification

- `npm -w apps/api run test:auth`: 53/53 passed with the default prefix.
- `NEXT_PUBLIC_AUTH_COOKIE_PREFIX=mm_staging npm -w apps/api run test:auth`: 53/53 passed.
- `npm -w apps/api run test:release-hardening`: 19/19 passed.
- `npm -w apps/web run test:api-base`: 10/10 passed with the default prefix.
- `NEXT_PUBLIC_AUTH_COOKIE_PREFIX=mm_staging npm -w apps/web run test:api-base`: 10/10 passed.
- API typecheck passed with `mm_staging`.
- Web typecheck passed with `mm_staging`.
- API build passed with `mm_staging`.
- A clean `/tmp` production web build passed with `mm_staging` and the staging API
  URL after building `@mm/core` and `@mm/futures-core` in dependency order. The
  primary workspace build had stalled without CPU activity in FileProvider storage;
  the clean-copy result is the verified build evidence.

## Staging activation gate

Before rebuilding staging API and web together, set this non-secret value in the
staging environment only:

```dotenv
NEXT_PUBLIC_AUTH_COOKIE_PREFIX=mm_staging
```

After the separately approved staging deploy, verify in a normal browser profile:

1. Password login reaches an authenticated page without a redirect loop.
2. The browser stores `mm_staging_session` and `mm_staging_csrf` for staging.
3. Authenticated reads and one CSRF-protected non-capital settings mutation succeed.
4. WalletConnect opens and SIWE nonce/signature verification succeeds using
   `mm_staging_siwe_nonce`.
5. Production remains authenticated and its `mm_*` cookies are unchanged.

No environment mutation, deploy, wallet signature, onchain action, or production
change was performed as part of this local implementation.
