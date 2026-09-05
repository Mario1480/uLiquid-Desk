# Dashboard workbench widgets — local implementation evidence

Date: 2026-09-05

## Scope

Implemented six configurable widgets: price alerts, trade journal, bot radar,
day/week summary, personal notes/checklist, and liquidation distance. Coin-specific
upcoming events were explicitly excluded.

Personal documents use user-scoped GlobalSetting keys and optimistic revision
checks. API and web layout defaults remain aligned. No database migration is
required. Existing trading and bot visibility gates are preserved.

## Behavior and limits

- Price alerts use Binance USDT reference quotes, not account execution prices.
  Checks run while the widget is mounted and the browser tab is visible; there is
  no background notification service. Stale/degraded quotes cannot trigger alerts.
- The journal combines recorded closed bot trades with user-entered manual
  records. Manual exchange trades are not automatically imported.
- Summary periods are today in UTC and the trailing seven days. Unknown fees or
  PnL remain unknown; net results are not fabricated. Bot history is bounded to
  5,000 records, with truncation disclosed.
- Bot radar covers standard bots and their last reported runtime state.
- Liquidation distance uses available exchange mark/liquidation prices. Missing
  prices remain unknown; the widget does not initiate trading actions.

## Validation

- 40 focused dashboard tests passed, covering preference isolation/conflicts,
  validation, alert freshness/latching, summary math, permission mapping, layout
  parity, liquidation distance, and bot-state priority.
- Targeted web and API TypeScript checks passed.
- English/German i18n integrity and Git whitespace checks passed.
- Isolated browser fixture used the real widget components and backend workbench
  handlers with synthetic data and an in-memory database. Desktop (1440px) and
  mobile (390px) rendering passed; all six mobile cards had no horizontal overflow.
- Browser interactions verified alerts, notes/checklist persistence, manual trade
  entry, source filtering, and automatic summary refresh after journal changes.
  A manual result of 50 with fees of 3 displayed net 47 without manual refresh.
- Fixture state persisted through browser reload. This is not production database
  persistence evidence.

## Remaining verification boundary

The full web typecheck did not complete locally and was terminated. Normal Next.js
dashboard browser navigation timed out; full authenticated dashboard acceptance
remains unverified. The isolated fixture is not a substitute for that check.
No deployment, production mutation, commit, or push was performed.
