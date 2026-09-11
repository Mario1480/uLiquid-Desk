# Consolidation Release Checklist

This checklist is the final release/merge gate for the current execution-platform consolidation track.

## Required build and regression checks

Run all of the following and require green results:

```bash
npm -w packages/futures-exchange run build
npm -w apps/api run typecheck && npm -w apps/api run build
npm -w apps/runner run typecheck
python3 -m py_compile apps/py-strategy-service/main.py apps/py-strategy-service/models.py apps/py-strategy-service/registry.py
npm run regression:core
```

## Required local smoke checks

Validate the local dev stack with:

```bash
docker compose -f docker-compose.dev.yml ps
curl -i http://localhost:4000/health
curl -i http://localhost:3000
curl -i http://localhost:9000/health
curl -i http://localhost:4000/settings/access-section
curl -i http://localhost:4000/admin/settings/access-section
```

Expected results:

- API health returns `200 OK`
- Web returns `307` and redirects to `/en`
- Python strategy service health returns `200 OK`
- protected API routes return `401 Unauthorized`
- API, Web, Runner, Redis, Postgres, and Python service are up in `docker compose ps`

## Accepted local non-blocking warning

The following warning is currently acceptable in local/dev smoke runs and does not block this consolidation release:

- `vault_onchain_factory_address_missing`

This warning is acceptable only while:

- API health is `ok`
- Web is reachable
- Runner is up
- Python strategy service is healthy
- core regression remains green

## Closure summary for this track

The current release gate is meant to confirm:

- API composition root is finalized
- Paper runtime/resolution contract is centralized
- Grid and Prediction Copier share normalized reconciliation/event semantics
- Strategy `v2` contract is the preferred standard with `v1` fallback
- docs and regression coverage reflect the current platform shape
