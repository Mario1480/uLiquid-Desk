# Demo Flows

This guide defines the three product-ready demo flows for uLiquid Desk that are currently the most repeatable for internal operators.

The goal is not to showcase every capability. The goal is to run three clean stories that:

- start from a recognizable user need
- exercise real platform differentiation
- avoid avoidable live-risk during demos
- have a clear fallback if one dependency is unstable

## Operator Prep

Use this checklist before any live demo session:

- Confirm the demo user has the required product gates:
  - Vaults
  - Grid bots
  - Predictions and at least one strategy type
- Confirm at least one usable exchange account exists.
- Prefer a `paper` account for execution demos unless the session explicitly requires live execution.
- If showing vault-backed flows, confirm `/vaults` loads and `/vaults/master` returns cleanly.
- If showing grid preview, confirm the Python strategy service is healthy.
- If showing predictions, confirm `/predictions` loads and at least one strategy option is visible.
- Keep `/admin/vault-operations` and `/admin/exchanges` open in a second tab for operator health checks.

## Flow 1: Wallet And Funding To Vault

### Story

Show that uLiquid Desk can take a user from capital visibility into explicit vault capital orchestration.

### Best route

- Start on `/wallet`
- Move to `/vaults`
- Optionally show `/admin/vault-operations` as the operator view

### What to demonstrate

1. Open `/wallet` and show the unified wallet and funding surface.
2. Open `/vaults` and show Vaults as a dedicated product surface, not a hidden wallet subfeature.
3. If the user does not yet have a master vault, create it through the UI/API-backed flow.
4. Show the master vault status and balances.
5. If the environment supports it, demonstrate a deposit flow into the master vault.
6. Explain how capital then becomes available for downstream bot vault and strategy flows.
7. For operator credibility, open `/admin/vault-operations` and show lifecycle/reconciliation visibility.

### Success criteria

- Wallet page loads without missing funding config noise.
- Vault page shows a valid master vault or a clean creation path.
- Master vault summary updates after create/deposit.
- Admin ops page shows healthy lifecycle and no obvious drift or lag.

### Dependencies

- `product.vaults` must be enabled for the demo user.
- Vault API routes must be healthy.
- If demonstrating on-chain funding:
  - wallet connectivity must work
  - vault on-chain config must be present
  - indexer/reconciliation jobs should be healthy

### Unstable steps

- Live on-chain confirmations
- wallet-connect friction
- delayed on-chain indexing
- environment-specific funding config

### Fallback path

- If on-chain actions are unstable, keep the demo on the vault state and operator visibility:
  - show existing master vault
  - show lifecycle state model
  - show vault operations and reconciliation surfaces
- If create/deposit is not safe to run live, use a pre-seeded demo user and narrate the transition from wallet capital to vault capital.

### Recommended positioning

- Emphasize explicit lifecycle and ops visibility.
- Do not overpromise broad retail self-custody readiness if the environment is still in simulated or controlled mode.

## Flow 2: Grid Bot Setup And Execution Preview

### Story

Show that uLiquid Desk turns a grid strategy from a rough idea into a validated, capital-aware, venue-aware launch plan.

### Best route

- Start on `/bots/grid`
- If needed, continue to `/bots/grid/new`
- Optional operator support: `/admin/grid-templates` and `/admin/exchanges`

### What to demonstrate

1. Open `/bots/grid` and show the grid dashboard.
2. Pick an existing template or move into the create/new flow.
3. Show the preview/validation layer:
  - minimum capital
  - reserve allocation
  - leverage expectations
  - liquidation proximity
  - readiness vs warning vs blocking output
4. Show that the preview is not just decorative:
  - too little capital blocks
  - thin liquidation buffer warns
  - venue constraints are validated
5. If the environment is stable, create or open a grid instance.
6. Show the resulting grid instance detail and, if available, related vault/provider metadata.

### Success criteria

- Preview loads and clearly explains whether the setup is ready.
- Operator can explain why the preview is safe, blocked, or warning-level.
- A created instance appears in the dashboard and can be opened.

### Dependencies

- `product.grid_bots` must be enabled for the demo user.
- Python grid planner service must be healthy.
- Venue metadata/constraints must be available.
- If the demo uses vault-backed grid execution, vault support must also be healthy.

### Unstable steps

- venue metadata drift
- environment-specific exchange constraints
- insufficient demo capital
- runtime execution fills if the demo goes beyond preview

### Fallback path

- If runtime execution is risky, stop at preview plus instance creation.
- If venue constraints are flaky, use a known-good published template and a stable demo venue.
- If live capital is tight, deliberately show a blocked preview first and then switch to a safe preconfigured template.

### Recommended positioning

- Lead with preview quality and safety transparency.
- The strongest message is not “we can place many orders,” but “we tell the operator exactly when the plan is unsafe.”

## Flow 3: Prediction And Strategy To Trade Execution

### Story

Show that uLiquid Desk can move from strategy selection and prediction generation into an actionable trade workflow with the same downstream desk surface.

### Best route

- Start on `/predictions`
- Continue to `/trade` through the prediction prefill path
- Prefer a `paper` account unless the session explicitly requires live execution

### What to demonstrate

1. Open `/predictions`.
2. Show available strategy choices:
  - AI prediction
  - local strategy
  - composite strategy
3. Generate or select a prediction for a supported symbol/timeframe.
4. Explain the signal, confidence, and selected strategy reference.
5. Use the prediction-to-trade path so the Trading Desk opens with a prefilled context.
6. In `/trade`, show the prefill block:
  - symbol
  - side/signal
  - leverage hint
  - TP/SL or entry guidance if present
7. If safe for the environment, place a small paper trade to complete the loop.

### Success criteria

- Prediction generation succeeds or an existing prediction can be opened.
- Strategy selection is visible and coherent for the user plan.
- Trade Desk receives the prediction prefill correctly.
- Paper/manual execution can be demonstrated without venue errors.

### Dependencies

- Relevant product gates must be enabled:
  - `AI predictions` for AI prompt-based flow
  - `Local strategies` for local strategy flow
  - `Composite strategies` for composite flow
- At least one supported exchange account should exist.
- For the cleanest execution demo, a valid `paper` account should already be configured.

### Unstable steps

- AI latency or model availability
- missing strategy entitlement for the chosen strategy kind
- no matching exchange account for prefill
- live execution risk if not using paper

### Fallback path

- If AI generation is slow or unstable, switch to a local strategy or a pre-existing prediction.
- If strategy-specific access is missing, choose the visible allowed strategy kind instead of forcing the preferred one.
- If execution should not be live, stop at trade prefill or place the order on `paper`.

### Recommended positioning

- Emphasize that the same downstream Trading Desk can consume multiple upstream signal sources.
- Avoid pitching AI quality as the core message; pitch operator workflow, explainability, and execution continuity.

## Choosing The Right Flow For The Audience

### For product and GTM

- Start with Flow 2
- Then Flow 3
- Use Flow 1 only if capital orchestration is part of the sales story

### For infrastructure or ops stakeholders

- Start with Flow 1
- Then show `/admin/vault-operations`
- Use Flow 2 only to show how safety validation prevents bad launches

### For strategy or trading audiences

- Start with Flow 3
- Then show Flow 2 as the structured automation path

## Demo Day Defaults

- Default execution venue: `paper`
- Default operator backup tab: `/admin/vault-operations`
- Default recovery move if a flow gets noisy:
  - stop on preview/visibility
  - narrate the next step
  - switch to the next flow instead of forcing a broken live interaction

## Known Fragile Areas

- live wallet/on-chain confirmation loops
- environment-specific exchange setup
- AI response latency
- stale demo data for prediction and vault summaries

These are acceptable as long as the operator treats them as branch conditions, not surprises.
