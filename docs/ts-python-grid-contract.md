# TS ↔ Python Grid Contract

This document describes the current contract boundary between TypeScript and the Python strategy service for Grid preview and Grid planning.

## Responsibility split

### Python owns

- Grid preview computation
- Grid planning / intent generation
- strategy-side grid math

### TypeScript owns

- request validation before the Python call where appropriate
- timeout and fallback rules
- auth token injection
- error normalization for callers
- venue resolution and venue-constraint selection
- persistence, execution, and lifecycle safety

## Current endpoints

### Legacy compatibility

- `POST /v1/grid/preview`
- `POST /v1/grid/plan`

These remain available so older API/runner callers or staged deployments can keep working.

### Current versioned envelope

- `POST /v2/grid/preview`
- `POST /v2/grid/plan`

These endpoints return a versioned envelope:

```json
{
  "protocolVersion": "grid.v2",
  "requestId": "grid_abc123",
  "ok": true,
  "payload": { "...": "preview_or_plan_payload" }
}
```

Structured error example:

```json
{
  "protocolVersion": "grid.v2",
  "requestId": "grid_abc123",
  "ok": false,
  "error": {
    "code": "grid_payload_invalid",
    "message": "grid payload validation failed",
    "retryable": false,
    "details": {
      "errors": []
    }
  }
}
```

## TypeScript client behavior

Both TypeScript callers prefer `v2` first:

- `/Users/marioeuchner/Documents/GitHub/uLiquid-Desk/apps/api/src/grid/pythonGridClient.ts`
- `/Users/marioeuchner/Documents/GitHub/uLiquid-Desk/apps/runner/src/grid/pythonGridClient.ts`

Fallback rule:

- if `v2` returns `404` or `405`, the client falls back to the equivalent `v1` endpoint
- structured `v2` errors are surfaced directly as client errors
- transport errors and timeouts still follow the existing timeout/fallback behavior of the caller

This lets API, runner, and Python be upgraded independently without breaking Grid in mixed deployments.

## Error expectations

For `v2`, callers should expect deterministic `error.code` values instead of scraping unstructured text where possible.

Current structured categories:

- `grid_payload_invalid`
- `grid_http_error`
- `grid_preview_failed`
- `grid_plan_failed`

Client-side normalized errors remain:

- `timeout`
- `network_error`
- `invalid_json`
- `invalid_response`

## Observability expectations

Every `v2` request includes a client-side `requestId`.

That request id should be treated as the stable correlation key for:

- API logs
- runner logs
- Python service logs
- future replay/debug tooling

## Regression coverage

Current explicit regression tests:

- `/Users/marioeuchner/Documents/GitHub/uLiquid-Desk/apps/api/src/grid/pythonGridClient.test.ts`
- `/Users/marioeuchner/Documents/GitHub/uLiquid-Desk/apps/runner/src/grid/pythonGridClient.test.ts`

Covered cases:

- `v2` success path
- `v2 -> v1` fallback
- structured `v2` error propagation

## Next hardening steps

1. add request/response protocol versioning to strategy-run endpoints as well
2. include richer `details` payloads for planner/preview failures where useful
3. add log correlation on the Python side with `requestId`
4. expand replay/debug support for problematic Grid requests
