# TS ↔ Python Strategy Contract

The strategy service is no longer an experimental sidecar. It is a product dependency, and the contract between TypeScript and Python needs to be explicit and versioned.

## Current standard

The preferred protocol is now `strategy.v2`.

TypeScript callers:

- `/Users/marioeuchner/Documents/GitHub/uTrade-Bots/apps/api/src/local-strategies/pythonClient.ts`
- `/Users/marioeuchner/Documents/GitHub/uTrade-Bots/apps/api/src/local-strategies/pythonRunner.ts`

Runner-side normalization keeps structured error codes stable and feeds them into the circuit-breaker / degraded-mode handling.

Python service:

- `/Users/marioeuchner/Documents/GitHub/uTrade-Bots/apps/py-strategy-service/main.py`
- `/Users/marioeuchner/Documents/GitHub/uTrade-Bots/apps/py-strategy-service/models.py`
- `/Users/marioeuchner/Documents/GitHub/uTrade-Bots/apps/py-strategy-service/registry.py`

## Preferred endpoints

- `GET /v2/strategies`
- `POST /v2/strategies/run`

The old `v1` endpoints are still supported as a compatibility fallback.

## Envelope shape

Both list and run endpoints follow the same envelope pattern:

- `protocolVersion`
- `requestId`
- `ok`
- `payload`
- `error`

### Success

```json
{
  "protocolVersion": "strategy.v2",
  "requestId": "req_123",
  "ok": true,
  "payload": { "...": "..." }
}
```

### Failure

```json
{
  "protocolVersion": "strategy.v2",
  "requestId": "req_123",
  "ok": false,
  "error": {
    "code": "strategy_payload_invalid",
    "message": "strategy payload validation failed",
    "retryable": false,
    "details": {}
  }
}
```

## Error semantics

Current structured codes include:

- `strategy_not_found`
- `strategy_auth_failed`
- `strategy_http_error`
- `strategy_degraded`
- `strategy_payload_invalid`
- `strategy_execution_failed`

TypeScript normalizes transport failures separately:

- `strategy_timeout`
- `network_error`
- `invalid_json`
- `protocol_version_mismatch`
- `invalid_response_shape`
- `disabled`

## Fallback rules

TypeScript callers prefer `v2` and fall back to `v1` only when the service clearly does not support `v2`:

- `404`
- `405`

This keeps rollout safe during mixed deploy states.

The runner-side circuit breaker treats both the historical `timeout` code and the structured `strategy_timeout`
code as timeout-class failures so mixed deploy states remain safe while the contract is being rolled out.

## Ownership boundary

Python owns:

- strategy registry contents
- strategy logic
- strategy scoring / allow decision

TypeScript owns:

- auth token injection
- timeout and circuit breaker
- fallback behavior
- error normalization
- execution safety and persistence

## Regression anchors

- `/Users/marioeuchner/Documents/GitHub/uTrade-Bots/apps/api/src/local-strategies/pythonClient.test.ts`
- `/Users/marioeuchner/Documents/GitHub/uTrade-Bots/apps/api/src/local-strategies/pythonRunner.test.ts`
- `/Users/marioeuchner/Documents/GitHub/uTrade-Bots/scripts/run_regression_matrix.sh`
