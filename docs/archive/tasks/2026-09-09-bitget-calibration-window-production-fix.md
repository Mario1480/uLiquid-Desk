# Bitget Calibration Window Production Fix

Date: 2026-09-09

## Problem

The feature-threshold calibration paginated historical candles backwards but passed the beginning of the complete calibration period as `startTime` on every request. Bitget rejected the initial `1h`, `4h`, and `1d` requests when that interval exceeded 90 days.

## Change

- Application commit: `bfd3257cb62c71850549228a8c6f4c4013f9ebc3`
- Bitget candle requests are now limited to a maximum 90-day interval per pagination step.
- The existing cursor continues backwards across successive requests, preserving the complete configured calibration period.
- Other exchange request windows remain unchanged.

## Verification

- The focused threshold tests passed: 6/6.
- The existing Perp market-data client tests passed: 6/6.
- The API TypeScript check passed.
- A public Bitget `1H` candle request covering exactly 90 days returned HTTP 200 and provider code `00000`.
- The production API image built successfully and was deployed with `./scripts/deploy_prod.sh --no-pull api`.
- Prisma found 116 migrations and reported no pending migrations.
- The API and Python strategy service reported healthy after the container replacement.
- Internal and public API health checks returned `{"ok":true}`.
- The new API startup logs contained neither the previous 90-day interval error nor another feature-threshold calibration failure.

No private exchange read, order, trading-gate change, contract call, or onchain transaction was performed.
