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

Fixture limitations: live chart/user WebSockets were unavailable; unrelated dashboard services used explicit unavailable responses. This verifies the affected UI and mocked request construction, not live fills or exchange reconciliation.

## Production release

- Release commit: `860fc8182e5feb34391d21200ddf72b58754347f` on `main`.
- Production repository fast-forwarded from `034dea5b76dd7ba0e0d0de930a5573626bc4f789`.
- Built the production web image successfully, including Next.js compilation, TypeScript and 98 generated pages.
- Recreated only the web service with `docker compose --env-file .env.prod -f docker-compose.prod.yml up -d --no-deps web`.
- Web container changed from `654c2b07cfd8` to `239cb5bd8f67` and became healthy. API `4dad08ec01f7`, runner `a0fe664b7932`, PostgreSQL `769e97fe8bb0`, Redis `0c817ad8da83`, Python strategy service `ba00e93e1afc`, and proxy `06cb505da85f` were unchanged and healthy.
- Rollback image retained as `uliquid-desk-web:rollback-20260908T071940Z-654c2b07cfd8`.
- Public API health returned HTTP 200 with `{"ok":true}`; login returned HTTP 200; unauthenticated Trading Desk and Calendar requests correctly returned HTTP 307 to `/en/login`.
- Beta access configuration remained available after the web-only release: HTTP 200, intake enabled, and a non-empty public Turnstile site key. No secret value was read or recorded.
- No live position, order, account, beta application, wallet, billing, database migration, or onchain mutation was performed as part of deployment validation.
