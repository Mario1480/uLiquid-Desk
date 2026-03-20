# Local Strategy Registry

## Purpose

uLiquid Desk now treats local strategies as a versioned registry instead of a loose collection of API and Python-side definitions.

The registry is driven by one shared manifest:

- [config/local-strategy-registry.json](/Users/marioeuchner/Documents/GitHub/uLiquid-Desk/config/local-strategy-registry.json)

This keeps API metadata, Python metadata, and admin-facing registry output aligned.

## Registry Model

Each strategy entry includes:

- `key`
  - stable registry identifier
- `type`
  - runtime strategy type used in requests today
- `version`
  - execution contract version for the strategy implementation
- `status`
  - `active`
  - `experimental`
  - `deprecated`
- `inputSchema`
  - normalized description of expected `featureSnapshot`, `config`, and `context`
- `outputContract`
  - normalized shape for strategy results
- `defaultConfig`
  - default runtime config for admin creation flows
- `uiSchema`
  - admin/editor metadata

## Runtime Alignment

API loader:

- [apps/api/src/local-strategies/catalog.ts](/Users/marioeuchner/Documents/GitHub/uLiquid-Desk/apps/api/src/local-strategies/catalog.ts)

Python loader:

- [apps/py-strategy-service/registry_manifest.py](/Users/marioeuchner/Documents/GitHub/uLiquid-Desk/apps/py-strategy-service/registry_manifest.py)

API registry:

- [apps/api/src/local-strategies/registry.ts](/Users/marioeuchner/Documents/GitHub/uLiquid-Desk/apps/api/src/local-strategies/registry.ts)

Python registry:

- [apps/py-strategy-service/registry.py](/Users/marioeuchner/Documents/GitHub/uLiquid-Desk/apps/py-strategy-service/registry.py)

Python app registration:

- [apps/py-strategy-service/main.py](/Users/marioeuchner/Documents/GitHub/uLiquid-Desk/apps/py-strategy-service/main.py)

The Python service now registers handlers from the shared manifest instead of duplicating config/status/version metadata inline.

## Versioning Rules

1. `type` remains backward-compatible for current callers.
2. `version` is the compatibility marker between API definitions and the Python service.
3. When the API sends a `strategyVersion` that does not match the Python registry entry, the Python service returns:
   - `strategy_version_mismatch`
   - HTTP `409`
4. The API can fall back to a TS strategy when a Python version mismatch occurs and a fallback is configured.

## Status Semantics

- `active`
  - supported for normal production use
- `experimental`
  - available, but should be treated as higher-risk and more closely observed
- `deprecated`
  - still runnable for backward compatibility, but not the preferred path for new usage

## Testing

API-side registry and compatibility coverage:

- [apps/api/src/local-strategies/registry.test.ts](/Users/marioeuchner/Documents/GitHub/uLiquid-Desk/apps/api/src/local-strategies/registry.test.ts)
- [apps/api/src/local-strategies/pythonClient.test.ts](/Users/marioeuchner/Documents/GitHub/uLiquid-Desk/apps/api/src/local-strategies/pythonClient.test.ts)

Python-side registry coverage:

- [apps/py-strategy-service/tests/test_registry.py](/Users/marioeuchner/Documents/GitHub/uLiquid-Desk/apps/py-strategy-service/tests/test_registry.py)

These tests cover:

- registry field alignment
- remote compatibility mismatch reporting
- strategy version mismatch handling
- API fallback behavior when Python versions drift

## Follow-Up

- Add admin write-path validation that warns when a deprecated strategy is selected.
- Add explicit migration guidance when a strategy version is bumped but an older DB definition still exists.
- Consider exposing `registryVersion` directly in admin registry responses for easier ops checks.
