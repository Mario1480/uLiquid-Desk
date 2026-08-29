# ULIQ lock-duration buffer preparation

Date: 2026-08-27

## Scope

- Local code preparation only.
- No Prisma migration execution, VPS deployment, runtime switch, contract
  deployment, wallet signature or other onchain action.
- Preserve exact subscription-term coverage and the 25% tier-minimum lock gate.

## Problem

The first finalized 31-day staging lock expired at
`2026-09-27T13:48:27Z`. A monthly subscription evaluated roughly one hour
later required coverage through `2026-09-27T14:50:33Z`. Because a calendar
month can itself be 31 days, the original fixed term left no time for receipt,
finality, indexing or checkout.

The UI also rounded the remaining duration up to `31 days`, while the exact
coverage comparison correctly reported the position as too short.

## Prepared change

- Replacement-locker initial terms: `32`, `185` and `367` days.
- Product labels remain `1`, `6` and `12` months.
- The additional day is an operational buffer, not a longer-benefit multiplier.
- `unlockAt` remains authoritative; discounted checkout still requires the lock
  to cover the exact planned subscription end.
- `extendLock` remains non-shortening and does not alter amount, owner,
  `lockedBalanceOf` or `totalLocked`.
- API validation accepts only the new buffered terms after the future runtime
  switch.
- Additive migration `20260827153000_uliq_lock_duration_buffer_v1` preserves all
  historical duration projections and admits the three new terms.
- The UI reports the non-rounded remaining duration and the concrete coverage
  shortfall instead of only saying `not covered`.

## Rollout gates

1. Contract and application tests must pass from a clean checkout.
2. Deploy the replacement locker only after a separate Arbitrum Sepolia stage
   approval.
3. Verify receipt, canonical block and RPC `finalized` inclusion separately.
4. Apply the additive migration and switch the staging locker address only
   after a separate VPS rollout approval.
5. Keep discounts disabled until the new-lock checkout E2E is accepted.
6. The existing 100,000 ULIQ test lock remains in the previous locker and must
   stay recoverable there after its original unlock timestamp; a runtime switch
   does not migrate or release those tokens.

## Local validation

- Foundry: `51` tests passed, including the Locker invariant suite and explicit
  rejection of the superseded `31/184/366` initial terms.
- ULIQ API: `72` tests passed, including buffered monthly coverage and migration
  compatibility.
- ULIQ Web: `8` tests passed, including exact shortfall calculation and
  non-rounded duration formatting.
- Web TypeScript, i18n integrity, Prisma schema validation and scoped Foundry
  formatting passed.
- The full API TypeScript check remains red only in pre-existing, unrelated
  Agent-Chat/Premium plugin capability types on this divergent ULIQ branch; no
  ULIQ file appears in its diagnostics.
