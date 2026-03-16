# Execution Foundation Gap List

## Landed in this pass

- Added a shared execution contract and pipeline in `packages/futures-engine`.
- Centralized venue capability validation and paper linked-market-data validation.
- Normalized execution responses across engine-backed and custom executor paths.
- Refactored runner simple execution, prediction copier engine bridging, and futures-grid delegated order/cancel handling onto the shared contract.
- Refactored manual perp order placement onto the shared contract.
- Tagged vault lifecycle execution events with shared execution metadata so provider-control events use the same reporting vocabulary.

## Still needs follow-up

- Move more manual trading mutations onto the shared pipeline.
  - `editOrder`
  - `cancelOrder`
  - `cancelAllOrders`
  - `setPositionTpSl`
  - `closePosition`
- Collapse remaining runner result builders onto the shared helper.
  - `legacyPredictionCopierExecutionMode`
  - any remaining bespoke result shapes in `futuresGridExecutionMode`
- Decide whether vault provider actions should use the full shared pipeline instead of only shared metadata.
  - Current vault work is metadata-aligned, not yet venue/risk-hook aligned.
- Pull runner guardrail state transitions closer to the shared pipeline if we want one end-to-end hook chain instead of pre/post handling in modes.
- Consider moving runner execution event helpers in `apps/runner/src/runtime/executionEvents.ts` into a shared package once spot/perp/vault reporting can share the same surface.
- Extend the shared contract for non-order actions if we want first-class parity for:
  - leverage-only mutations
  - TP/SL-only mutations
  - provider lifecycle controls
- Add broader parity tests around:
  - live manual trading adapters
  - paper futures-grid terminal flows
  - vault provider lifecycle events persisted to the database

## Intentional non-goals for this pass

- Rewriting planner logic in futures grid.
- Changing exchange adapter behavior.
- Changing vault provider orchestration semantics.
