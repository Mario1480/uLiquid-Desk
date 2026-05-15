---
description: Runtime, lokale Entwicklung, Production und GitBook Sync.
icon: server
---

# Runtime und Deployment

Diese Seite ist eine kompakte Orientierung fuer Admins und Entwickler, die die User-Dokumentation mit Betriebskontext verbinden muessen.

## Lokale Entwicklung

Das Repo nutzt npm Workspaces. Fuer lokale Entwicklung:

```bash
npm install --workspaces --include-workspace-root --legacy-peer-deps
npm run docker:dev:up
npm run dev:api
npm run dev:web
```

Standardziele:

- Web: `http://localhost:3000`
- API: `http://localhost:4000`
- Health: `http://localhost:4000/health`

## Production

Production nutzt Web, API, Runner, PostgreSQL, Redis und Caddy. Details stehen in:

- [Production Deploy](../PRODUCTION_DEPLOY.md)
- [Configuration](../configuration.md)
- [Caddy Migration](../CADDY_MIGRATION.md)

## Health Checks

Vor operativen Tests pruefen:

- API `/health`.
- Web erreichbar.
- DB und Redis verbunden.
- Runner aktiv.
- Exchange APIs erreichbar.
- Python Strategy Service erreichbar, falls Grid/Strategy Preview genutzt wird.

## GitBook Sync

Dieses Repo ist fuer GitBook Git Sync vorbereitet:

- `.gitbook.yaml` liegt im Repo-Root.
- `root` zeigt auf `./docs/`.
- `docs/README.md` ist die Startseite.
- `docs/SUMMARY.md` ist die Sidebar.
- `skill.md` liegt im Repo-Root als GitBook-AI-Kontext fuer lokale Docs-Bearbeitung.

Bei neuen Seiten:

1. Markdown-Datei unter `docs/` anlegen.
2. Relative Links verwenden.
3. Seite in `docs/SUMMARY.md` eintragen.
4. Frontmatter mit `description` und optional `icon` setzen.
5. Links lokal pruefen.
