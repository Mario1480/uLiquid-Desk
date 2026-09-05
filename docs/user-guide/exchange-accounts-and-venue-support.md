---
description: Connect exchange accounts safely and verify feature support for the selected venue.
icon: landmark
---

# Exchange Accounts and Venue Support

An exchange account connects uLiquid Desk to a venue for the features enabled for that account and environment. Support can differ by venue, market type, account configuration, runtime availability, and product rollout.

## Add an Account Safely

1. Open **Settings** and then **Exchange Accounts**.
2. Choose the intended venue and give the account a clear label.
3. Enter only the credentials requested by the form. Some venues require an additional passphrase.
4. Complete re-authentication when prompted.
5. Verify connection status, balances, and read-only data before attempting a live workflow.

## Minimum API-Key Rules

- Never enable withdrawal permission for an API key used by uLiquid Desk.
- Use only the read and trading permissions required for your intended workflow.
- Apply an IP allowlist at the venue when it is available and compatible with your setup.
- Keep production, test, and personal accounts clearly separated by label.
- Rotate or revoke a key immediately if you suspect exposure; then update the account through the normal secure workflow.

## Verify Venue Capability Before Use

Do not infer support from a venue name alone. In the selected account and Trading Desk, confirm that the required action is available for the intended market:

- market data and account reads,
- spot or perpetual trading,
- permitted order type,
- leverage or margin-mode control,
- position close and protective-order controls,
- bot, grid, funding, or vault workflow.

The product blocks unsupported combinations. Treat such a block as a compatibility signal, not as something to work around by repeatedly submitting the action.

## Paper and Linked Data Accounts

Paper workflows may use linked market data from an eligible account. They are for controlled testing and do not prove that a live venue, credential, order type, or funding workflow is ready for production capital.

## If an Account Is Degraded or Disconnected

1. Stop creating new live actions for that account.
2. Check the venue status, API-key permissions, IP restrictions, and account label.
3. Refresh the account state and compare positions or orders directly with the venue.
4. Do not remove and recreate an account solely to clear an unexplained live-data mismatch.
5. If the problem persists, collect a support package with timestamp, workspace, account label, venue, and displayed error.
