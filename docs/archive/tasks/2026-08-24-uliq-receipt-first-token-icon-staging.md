# ULIQ receipt-first purchase UX and token icon staging rollout

Date: 2026-08-24

## Approved scope

- Isolated Hostinger staging VPS `1286926` (`76.13.10.40`).
- Additive Prisma migration for persistent receipt-first purchase tracking.
- Rebuild and recreate only the API and web services.
- No production deployment, environment mutation, contract deployment, presale
  activation, wallet signature, or other onchain action.

## Local release evidence

- Prisma schema validation and client generation passed.
- `npm -w apps/api run test:uliq`: 42/42 passed.
- API typecheck and production build passed.
- Web typecheck, i18n integrity, wallet-watch tests (4/4), and staging-configured
  production build passed.
- Local browser smoke verified the German ULIQ page at desktop and 390 px mobile:
  receipt-first purchase history rendered, the add-token action stayed disabled
  without the matching connected wallet, no horizontal main-content overflow was
  present, and no browser console error was observed.
- The hosted 512 px token icon returned HTTP 200 as `image/png`.

## Deployment evidence

- Hostinger state inspection matched the isolated running VM `1286926` at
  `76.13.10.40` before the write.
- Deploy commit: `7751d13355a4c7f5202855d9c066c5bd37deb57c` on
  `origin/codex/uliq-mvp-testnet`; the VPS checkout was clean and detached at
  that exact commit during the image build.
- Pre-migration database dump:
  `/root/uliq-staging-pre-7751d133-20260824T134351Z.dump` (mode `0600`).
- Rollback images:
  `uliquid-desk-api:rollback-7751d133-20260824T134351Z` and
  `uliquid-desk-web:rollback-7751d133-20260824T134351Z`.
- Prisma found 106 migrations and successfully applied only
  `20260824123000_uliq_receipt_first_purchase_tracking`; the new table was
  present with zero initial rows.
- Only API and web were recreated. API image
  `sha256:2fb6e78ebfd9e315078849885532699e785d707c9e26f6b4f33968fe917fd827`
  and web image
  `sha256:0a79434302ff061225bdf98f30c2cc03dbdd2fe12e5147df308557f37a07647e`
  were both healthy with zero restarts after replacement. Postgres, Redis,
  runner, Python strategy service, and Salad proxy remained healthy.
- Local and public API health returned `{"ok":true}`. Public presale state
  remained `ACTIVE` on Arbitrum Sepolia, with both RPC providers healthy and
  finalised-head agreement true.
- The indexer cursor advanced to finalised block `301528897`, with
  `failure_count=0` and no last error. The latest reconciliation was `OK` with
  zero mismatches, and no open ULIQ indexer/reconciliation/tracking alert was
  present.
- The public 512 px token icon returned SHA-256
  `31862af0ee04c60ab416b163410e643f3ce593fbcba98cc96192ee931f6871ff`,
  exactly matching the committed local asset.
- Unauthenticated ULIQ and direct/legacy ULIQ admin routes resolved normally to
  the staging login page with HTTP 200. An authenticated wallet prompt was not
  opened during deployment verification.

No environment value, contract, presale state, wallet, signature, production
service, or other onchain state was changed by this rollout.
