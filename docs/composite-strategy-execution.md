# Composite Strategy Execution

## Purpose

Composite strategies now produce a more explicit execution trace and a standardized output object that can feed downstream prediction handling without reconstructing intent from raw node metadata.

Key implementation files:

- [runner.ts](/Users/marioeuchner/Documents/GitHub/uLiquid-Desk/apps/api/src/composite-strategies/runner.ts)
- [graph.ts](/Users/marioeuchner/Documents/GitHub/uLiquid-Desk/apps/api/src/composite-strategies/graph.ts)
- [index.ts](/Users/marioeuchner/Documents/GitHub/uLiquid-Desk/apps/api/src/index.ts)

## Graph Model

Composite graph nodes now support:

- `id`
- `kind`
  - `local`
  - `ai`
- `refId`
- `refVersion`
  - optional, but used for stronger local strategy compatibility checks
- `configOverrides`
- `position`

Edges continue to support:

- `always`
- `if_signal_not_neutral`
- `if_confidence_gte`

## Execution Traceability

Each node result now carries:

- execution `status`
  - `executed`
  - `skipped`
  - `failed`
- `inputTrace`
  - input signal/confidence
  - incoming edge state
  - previous node id
- `outputTrace`
  - output signal/confidence
  - signal source
  - expected move when AI output is available
- `diagnostics`
  - structured failure or skip reasons

This makes it easier to debug:

- missing dependencies
- edge-rule blocking
- local node exceptions
- AI prompt/generation failures
- final merge rationale

## Standardized Output

The runner now returns:

- `predictionOutput`
  - normalized composite signal
  - normalized confidence
  - expected move
  - selected signal source
  - explanation
  - tags
  - key drivers
  - selected node id
  - optional normalized AI prediction
- `decisionTrace`
  - combine mode
  - output policy
  - executed/skipped/failed node ids
  - conflicting signals
  - selected node id
  - rationale

The API prediction flow now uses this standardized `predictionOutput` instead of re-deriving the final decision from the last executed AI node.

## Failure Handling

Partial node failures no longer have to abort the full composite run.

Current behavior:

- failing node is recorded with `status: failed`
- downstream nodes depending on that node are skipped with dependency diagnostics
- final result still includes a complete trace and merged decision output

## Version Validation

Composite graph validation now supports stronger local strategy checks:

- `node_ref_not_found`
- `node_ref_version_missing`
- `node_ref_version_mismatch`

This helps catch stale graph references before execution.

## Merge Behavior

Supported merge behavior:

- `pipeline`
  - execution order follows the topological graph
- `vote`
  - non-neutral executed nodes vote by summed confidence

Supported output policies:

- `first_non_neutral`
- `override_by_confidence`
- `local_signal_ai_explain`

The final `decisionTrace.rationale` records which policy path selected the final decision.

## Tests

Coverage is in:

- [runner.test.ts](/Users/marioeuchner/Documents/GitHub/uLiquid-Desk/apps/api/src/composite-strategies/runner.test.ts)
- [graph.test.ts](/Users/marioeuchner/Documents/GitHub/uLiquid-Desk/apps/api/src/composite-strategies/graph.test.ts)

Scenarios covered include:

- branching graphs
- conflicting signals
- missing local strategy version
- partial node failure
- AI gating and budget skips
