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

## Staging deployment

The separately approved staging deployment was completed on VPS `1286926`
(`76.13.10.40`) from commit `5eb4908e`.

- Set the non-secret staging-only value:

```dotenv
NEXT_PUBLIC_AUTH_COOKIE_PREFIX=mm_staging
```

- Tagged the previous API and web images with
  `cookie-rollback-0aa3ac2c-20260823T083150Z` before replacement.
- Built and recreated only `api` and `web`; no database migration was run. The
  deployed API command is `node apps/api/dist/bootstrap.js`.
- The remote checkout is clean and pinned to `5eb4908e`.
- API and web containers are `healthy`; neither showed an API error nor a migration
  log line in the post-deploy window.
- Public `GET /health`, `GET /uliq/presale`, and the German login page returned
  HTTP `200`.
- The public presale state remained `READY`, not `ACTIVE`.
- Loading the login page with a synthetic parent-domain `mm_session` still returned
  HTTP `200`; the page remained at `/de/login` in the normal Chrome profile instead
  of entering the previous redirect loop.
- `GET /auth/me` with only that synthetic `mm_session` returned HTTP `401`, proving
  that staging does not accept the production cookie name as its session.

## Browser handoff and remaining checks

The normal Chrome profile now has the staging login page open at `/de/login`. Login,
WalletConnect, SIWE signing, and any authenticated mutation require Mario's manual
credentials or wallet approval and were intentionally not executed by the deploy.
After login, complete these user-authorized checks:

1. Password login reaches an authenticated page without a redirect loop.
2. Authenticated reads and one CSRF-protected non-capital settings mutation succeed.
3. WalletConnect opens and SIWE nonce/signature verification succeeds using
   `mm_staging_siwe_nonce`.
4. Production remains authenticated and its `mm_*` cookies are unchanged.

No wallet signature, onchain action, presale activation, database migration, or
production change was performed.
