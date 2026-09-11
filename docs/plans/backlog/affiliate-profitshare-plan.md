# Affiliate Profitshare Implementation Plan

## Product Rules

- Platform profitshare stays global, default `5%`.
- Affiliate profitshare is additional, default `10%`, and comes from the referred user's realized profit.
- Affiliate fees only accrue on real profit-share events.
- Referral assignment is intended to be stable and should be frozen for future vault-fee resolution once V4 vault creation is introduced.
- Existing vaults are not retrofitted. The affiliate fee model will apply to new vaults/contracts.

## Delivery Slices

### Slice 1: Foundation

- Prisma models for affiliate profiles, referral assignments, per-affiliate overrides, and affiliate accruals.
- Global admin setting `admin.affiliateProgram.v1` with:
  - `enabled`
  - `platformFeeRatePct`
  - `defaultAffiliateFeeRatePct`
- Admin API for:
  - reading/updating affiliate program settings
  - reading/updating a user's affiliate override
- User API for affiliate dashboard basics
- Register flow support for `referralCode`
- Admin page and user dashboard skeleton

### Slice 2: Revenue Pipeline

- Resolve effective affiliate relationship and fee split during vault creation.
- Persist split metadata on new vaults and/or creation execution metadata.
- Extend fee settlement pipeline to create `AffiliateAccrual` rows from `FeeEvent`s.
- Add admin reporting for open liabilities and paid accruals.

### Slice 3: Contract / Onchain

- Introduce `BotVaultV4` and `BotVaultFactoryV4`.
- Store `profitShareFeeRatePct` per vault.
- Use vault-specific fee rate for claim/close/recovery validation.
- Freeze effective total fee at vault creation time.

### Slice 4: Ops / Payouts

- Admin referral assignment workflows.
- Affiliate payout run / status transitions.
- Export and payout history.

## Notes

- The affiliate split does not need onchain recipient-splitting in the contract. Onchain should enforce the total fee. Internal accounting can split platform vs affiliate amounts.
- The current foundation slice intentionally does not yet modify settlement logic or vault deployment logic.
