# Ein UI controls production release

Mario authorized redeployment. UI source `400d1a16c` was published to `origin/main` and deployed on 2026-09-07 at 05:12:27 UTC.

## Source and scope

- Reconciled UI-only changes from `77c3c0800` onto production base `1e0c6db5b` in an isolated release worktree. The existing feature branch was preserved.
- Excluded browser logs, screenshots, unrelated Phase 2 documentation and older branch-only ULIQ behavior. The presale context conflict retained production content and behavior while adopting the new badge/checkbox/anchor primitives.
- Only web was built and recreated. No environment synchronization, gate changes, API/runner restart, migrations or transactions.
- Server checkout: `/opt/uliquid-desk`; existing untracked `backups/` preserved.

## Verification

- Release-base Ein UI contracts: 14 passed. Eight additional web suites: 64 passed. i18n and whitespace checks passed.
- Registry/source/license/prefix/import guard: 44 entries, 54 source files, 107 routes verified.
- Server production Docker build passed, including TypeScript and 98 generated pages; dependency layers were cached.
- Live API health and English login: HTTP 200. Internal gallery without authentication: HTTP 307.
- Chrome production login at 1440, 390 and 360 px: no horizontal overflow; shared auth card widths 480, 347 and 317 px respectively; computed background `rgba(255,255,255,0.1)` and blur `20px`. Five Ein button markers present. The old live page had no shared auth frame before activation.
- Web healthy with zero restarts. API, runner, PostgreSQL, Redis, Python strategy service and proxy container identities unchanged.
- Authenticated flows, full browser matrix and capital canaries were not rerun in production. Prior local UI checks are not substituted for those acceptance gates.

## Deployment and rollback

```sh
docker compose --env-file .env.prod -f docker-compose.prod.yml build web
docker compose --env-file .env.prod -f docker-compose.prod.yml up -d --no-deps --no-build web
```

New web container: `aabf74d4e4c2`. Running image: `sha256:dea003528e14e64fbd3056e08324d91998d4555a7dc83d60119531cd9f77f027`.

Previous web container: `b7c4c5724cf0`. Previous image retained as `uliquid-desk-web:einui-controls-rollback-20260907` (`sha256:a37f4a2cbfeb5a69507642325f289a26c8f576cd3e125cb7f555819f3d8e8d6c`). Rollback was not needed or rehearsed; if authorized, retag it to the Compose web image and recreate only web with `--no-deps --no-build`.
