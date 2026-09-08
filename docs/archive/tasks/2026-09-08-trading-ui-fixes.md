# Trading and Dashboard UI Fixes

## Scope and implementation

- Raise the focused Trading Context section above the chart so the symbol menu stays visible.
- Scope the Closing label to the matching symbol and position side, while retaining the shared mutation lock.
- Add shared desktop/mobile TP/SL inputs with estimated linear-position PnL and margin-based ROE conversion. Positive ROE represents profit for either side; negative ROE represents loss. Estimates exclude fees and funding. Unavailable margin disables ROE conversion.
- Replace immediate full-close confirmation with a position-specific dialog showing account, side, percentage, quantity and estimated PnL. Support presets and custom percentages. Full closes retain `/api/positions/close`; partial closes use the existing idempotent `/api/orders` path, with opposite-side reduce-only market orders for futures and sells for spot. Existing API/exchange validation and quantity normalization remain authoritative. The latest locally available position size is used at submission; account and market context are checked again.
- Reset the shared switch's native padding, alignment and box sizing.
- Use the standard dashboard glass density for Wallet and Funding Rates.
- Map calendar impact classes to semantic badge tones and fix central badge selector precedence.

No API contract, Prisma, runner, billing or contract changes were required. The shared execution pipeline already supports partial reduce-only orders and exchange quantity normalization. A new BingX adapter regression verifies partial close payloads for both sides in hedge and one-way modes.

## Local validation

- Web TypeScript: passed. Initial direct check found duplicate generated `.next` declarations; removed only generated duplicates and ran the workspace typecheck successfully. Final direct typecheck also passed.
- Translation integrity: passed for English and German.
- Position arithmetic and BingX adapter tests: 17 passed.
- Ein UI tests: 14 passed.
- Ein UI source/registry verification: passed; updated only reviewed Desk hashes, preserving upstream hashes.
- Diff whitespace check: passed.

## Browser evidence

Local Next.js with an isolated read-only mock API and Playwright-intercepted synthetic responses. All tested order requests were fulfilled in Playwright; no exchange orders or production mutations were sent.

- Desktop: symbol menu hit-testing confirms it renders above the chart surface.
- Switch geometry: 44 px track, zero native padding, 3 px left inset when off and 3 px right inset when on.
- Desktop and 390 px: entry 100, size 2, margin 20, TP ROE 50% produces price 105 and estimated PnL +10 USD.
- Mock 50% long close: quantity 1, opposite side, reduce-only and idempotency key verified. The other position does not show Closing.
- Mobile close dialog: invalid zero percentage disables confirmation; presets work. At 360 px the page has no horizontal overflow. Settled dialog screenshot inspected.
- Calendar: rendered low/medium/high badges have distinct green/yellow/red text and backgrounds.
- Dashboard: Wallet, Funding Rates, Watchlist and Market Sessions all resolve to `rgba(255, 255, 255, 0.1)` with `blur(20px)`.

Fixture limitations: live chart/user WebSockets were unavailable; unrelated dashboard services used explicit unavailable responses. This verifies the affected UI and mocked request construction, not live fills, exchange reconciliation or production runtime. No deployment, commit or push was performed.
