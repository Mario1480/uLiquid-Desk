# Hyperliquid Spot Smoke Test

This checklist verifies the new Hyperliquid spot path in the existing Trading Desk.

## Goal

Confirm that a user can:

1. add a Hyperliquid exchange account
2. open the Trading Desk in `spot` mode
3. see Hyperliquid spot balances and symbols
4. place a small spot order
5. see the order reflected in balances and open orders
6. cancel or sell back via the same Trading Desk flow

This smoke test is intentionally scoped to the personal Hyperliquid exchange account.
It does not move funds into `MasterVault` or `BotVault`.

## Preconditions

1. Local API is running on `http://localhost:4000`
2. Local web app is running on `http://localhost:3000`
3. You can sign in to the app
4. You have a Hyperliquid account with:
   - wallet address as `apiKey`
   - private key as `apiSecret`
   - optional vault/subaccount address as `passphrase`
5. The Hyperliquid account has enough quote balance for a tiny test order
   - recommended: USDC

## Notes About Local Health

If `/health` shows `vault_onchain_factory_address_missing` while the app is in `onchain_simulated`, that does not block this Trading Desk spot test.

Reason:

- Hyperliquid spot trading in the Trading Desk uses the manual trading stack
- it does not depend on the Vault onchain indexer

If you want a cleaner local health page during this smoke test, switch vault mode to `offchain_shadow`.

## Step 1: Add a Hyperliquid Exchange Account

Open:

- `http://localhost:3000/en/settings`

Create an exchange account with:

1. `exchange = hyperliquid`
2. `label = Hyperliquid Spot Test`
3. `apiKey = 0x...` wallet address
4. `apiSecret = 0x...` private key
5. `passphrase = 0x...` only if you intentionally trade through a Hyperliquid vault/subaccount

Expected:

1. account saves successfully
2. the account appears in the existing exchange account list

## Step 2: Open Trading Desk

Open:

- `http://localhost:3000/en/trade`

Select:

1. the new Hyperliquid account
2. market type `Spot`

Expected:

1. Spot mode is allowed for the Hyperliquid account
2. no `spotModeNotAvailableForAccount` warning appears
3. symbols load

## Step 3: Verify Spot Data

Before placing an order, verify:

1. the symbol selector loads Hyperliquid spot symbols
2. ticker/market data updates
3. account snapshot shows balances
4. open orders and positions sections load without crashing

Recommended first symbol:

1. a liquid `...USDC` market
2. preferably the asset you actually want to buy for follow-up flows, e.g. HYPE if available

## Step 4: Place a Tiny Buy Order

Use a very small test amount.

Recommended sequence:

1. choose `market`
2. choose side `Buy`
3. enter a small quantity
4. submit

Expected:

1. success message appears
2. balance updates after refresh/poll
3. if the order rests or partially fills, it appears in open orders

## Step 5: Verify Readbacks

Confirm:

1. `account snapshot` changed as expected
2. `positions` shows the bought spot asset as a long inventory row
3. `open orders` is empty for a fully filled market order

## Step 6: Sell / Cancel Test

Depending on the previous result:

1. if you still have an open order, cancel it
2. if the buy filled, place a small sell order for the same symbol

Expected:

1. cancel works without API errors
2. sell works without symbol or balance mismatch
3. balances return close to the starting state, minus fees/slippage

## Failure Checks

If something fails, capture:

1. selected account id
2. symbol
3. market type
4. API error payload from browser devtools
5. related API logs around:
   - `/exchange-accounts`
   - `/api/symbols`
   - `/api/account/summary`
   - `/api/orders`

## Expected Non-Goals For v1

The following is not part of this smoke test and should not be treated as a bug in this path:

1. automatic transfer of bought assets into `MasterVault`
2. automatic Vault funding from Trading Desk spot balances
3. TP/SL in spot mode
4. spot shorting or margin spot behavior

## Suggested First Real Test

1. add Hyperliquid account
2. open Trading Desk
3. switch to `spot`
4. buy a very small HYPE amount
5. verify balances and symbol handling
6. optionally sell it back
