---
description: Runtime, local development, production, and GitBook Sync.
icon: server
---

# Runtime and Deployment

This page gives admins and developers a compact orientation for connecting the user documentation with operational context.

## Local Development

The repository uses npm Workspaces. For local development:

```bash
npm install --workspaces --include-workspace-root --legacy-peer-deps
npm run docker:dev:up
npm run dev:api
npm run dev:web
```

Default targets:

- Web: `http://localhost:3000`
- API: `http://localhost:4000`
- Health: `http://localhost:4000/health`

## Production

Production uses web, API, runner, PostgreSQL, Redis, and Caddy. Details are available in:

- [Production Deploy](../PRODUCTION_DEPLOY.md)
- [Configuration](../configuration.md)
- [Caddy Migration](../CADDY_MIGRATION.md)

## Health Checks

Before operational tests, check:

- API `/health`.
- Web is reachable.
- DB and Redis are connected.
- Runner is active.
- Exchange APIs are reachable.
- Python Strategy Service is reachable if grid or strategy preview is used.

## GitBook Sync

This repository is prepared for GitBook Git Sync:

- `.gitbook.yaml` is in the repository root.
- `root` points to `./docs/`.
- `docs/README.md` is the homepage.
- `docs/SUMMARY.md` is the sidebar.
- `skill.md` is in the repository root as GitBook AI context for local documentation edits.

For new pages:

1. Create the Markdown file under `docs/`.
2. Use relative links.
3. Add the page to `docs/SUMMARY.md`.
4. Set frontmatter with `description` and optionally `icon`.
5. Check links locally.
