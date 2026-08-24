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

To be completed after the approved staging deployment.
