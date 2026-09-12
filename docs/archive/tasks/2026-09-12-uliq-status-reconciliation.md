# ULIQ Status Reconciliation

Date: 2026-09-12

## Scope

Mario corrected the older ULIQ open-gate inventory. This documentation-only
reconciliation records his current owner status and a fresh public, read-only
Mainnet Presale snapshot. It did not submit a wallet or Safe transaction,
change configuration, enable purchases, fund a contract, or activate a sale.

## Owner-confirmed updates

- Legal matters are clarified and approved.
- The independent audit is in progress.
- Round 1 dates are configured; Round 2 start and end remain open.
- Presale Terms are complete and online.
- Product tier, discount, and AI Credit cap configuration is complete.
- The two-round design is final.
- Round 1 is prepared and funded.
- Safe setup is complete.
- Presale RPC/indexer work is expected to be complete and requires a current
  runtime evidence refresh because the public endpoint does not expose the
  background job state.

## Public Mainnet observation

`GET https://api.desk.uliquid.vip/uliq/public/presale` returned a finalized
snapshot at block `504405448` with both round configurations `VALID`.

- Round 1: `DRAFT`, schedule source `BACKEND_DRAFT`, start
  `2026-09-19T12:00:00Z`, end `2026-12-31T12:00:00Z`, inventory funded, and
  allocation cap `50,000,000 ULIQ`.
- Round 2: `DRAFT`, schedule not configured, inventory not funded, and
  allocation cap `100,000,000 ULIQ`.
- Purchases are disabled and no listing timestamp is set.
- Terms version `2026-09-07` is ready with SHA-256
  `4f5e97a64569a271ecc475f9b3db44b2140e3b799e5a202ed54c563ebdeaf71d`.

The current status and remaining release path are maintained in
[`../../status/uliq-release-status.md`](../../status/uliq-release-status.md).

