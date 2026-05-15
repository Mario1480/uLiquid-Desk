---
description: Controlled go-live preparation, canary rollout, and smoke-test checklists.
icon: clipboard-check
---

# Go-live and Smoke Tests

For uLiquid Desk, go-live should not be a big-bang release. Use a controlled canary with small limits, clear observation, and a rollback path.

## Before Go-live

- Set production secrets outside the repository.
- Test database migration on staging.
- Run a fresh install or Docker build from the current lockfile.
- Check Caddy, API, and web routing.
- Test admin and user roles.
- Verify exchange accounts with real read data.
- Test wallet and funding flows with small amounts.
- Define monitoring and alert paths.

## Trading Smoke

1. Load account data.
2. Load symbols.
3. Check market data.
4. Create a limit order.
5. Cancel one order.
6. Test cancel all.
7. Open a small position.
8. Close the position.
9. Cross-check the exchange UI against the Trading Desk.

## Grid Bot Smoke

1. Calculate template preview.
2. Check budget, reserve, and liquidation distance.
3. Check funding source.
4. Start BotVault provisioning.
5. Observe seed and grid placement.
6. Check runner status.
7. Test stop or pause.
8. Test settlement and withdrawal separately.

## Wallet and Funding Smoke

- Connect wallet.
- Switch to HyperEVM.
- Arbitrum -> HyperCore deposit.
- HyperCore -> HyperEVM transfer.
- HyperEVM -> HyperCore transfer.
- Spot <-> Perps transfer.
- Fund the BotVault wallet.
- Check funding history and pending status.

## Admin Smoke

- Login and email verification.
- Password reset.
- OTP or re-authentication.
- User role without admin rights.
- Admin role with expected rights.
- SMTP test.
- Telegram test.
- Audit entry after a critical action.

## Related Internal Documents

- [Go-live Readiness Follow-ups](../go-live-readiness-followups.md)
- [Trading Desk Go-live Status](../trading-desk-go-live-status.md)
- [Wallet & Funding Go-live Status](../wallet-funding-go-live-status.md)
- [GridBot Go-live Status](../gridbot-go-live-status.md)
- [BotVault Go-live Follow-ups](../botvault-go-live-followups.md)
- [Smoke Test](../SMOKE_TEST.md)
