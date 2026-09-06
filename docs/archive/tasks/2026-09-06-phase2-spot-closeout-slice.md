# Phase 2 closeout — spot context and drawer slice

Status: implementation and local verification in progress; not Phase 2 completion.

Mario authorized completing the remaining Phase 2 work, including the previously discussed publication and acceptance steps. Trading actions, account settings, new monitoring activations and database migrations remain outside this slice. The historical storage strategy is awaiting an explicit owner choice.

## Changes

- Standalone spot Copilot now loads the existing shared 100-candle 1h indicator and 25-level orderbook datasets using synthetic public credentials and the same spot backend selection as Agent Chat. Paper resolves its owner-checked linked venue. No derivative data is requested for spot.
- Existing entitlement/ownership ordering and read-only model policy remain unchanged. The explanation cache namespace is v5 to invalidate pre-enrichment spot explanations; explanation and original evidence remain one cache entry.
- Both AI consumers normalize decimal-string book levels strictly, without converting null/empty/boolean values to numbers. Invalid levels fail closed. Binance Spot depth update IDs are not treated as timestamps, and missing observation time remains degraded.
- Orderbook skill v4, Market Analyst v7 and Position Copilot v8 record the material contract change. Routine/feature calculation versions are unchanged.
- The previously verified local drawer correction disables the shell animation only for Agent Chat. No unrelated local UI edits are included in this slice.

## Public read observations

A native Binance BTCUSDT spot read initially returned indicators but rejected string-valued book levels at the shared schema boundary. Direct inspection confirmed numeric strings and an update sequence in the client timestamp field. After normalization, both indicator and book features were returned. Forming-candle and missing-provider-timestamp warnings remained explicit. No credentials, private data, orders or paid AI calls were used.

The existing native client and official [Binance Spot API documentation](https://github.com/binance/binance-spot-api-docs/blob/master/rest-api.md) establish that REST depth returns `lastUpdateId`, not an observation time. Other venue live certification is not inferred from this smoke.

## Open acceptance

- Release and target-environment mobile acceptance.
- Exact standalone cached evidence at the live consumer boundary.
- Genuine stale/eligible fallback scenarios and controlled fixed-prompt comparison.
- Historical strategy, provider coverage and approved storage scope. No history feature or migration is claimed here.
