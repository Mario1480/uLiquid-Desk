# uLiquid Desk Agent Project Guide

Last updated: 2026-05-18

Diese Datei ist eine Projektkarte fuer Codex-/Agenten-Arbeit in diesem Repository. Sie beschreibt, was uLiquid Desk ist, wie das Monorepo aufgebaut ist, wo zentrale Feature-Bereiche liegen und welche Checks vor Aenderungen sinnvoll sind.

## Projekt in Kurzform

uLiquid Desk ist eine multi-tenant Futures-Trading-Plattform mit Web-App, API, Runner-Worker, Exchange-Integrationen, AI-Predictions, Grid-Bots, BotVault/FundingVault-Onchain-Flows, Billing/Licensing und Admin-/Go-live-Operations.

Kernfluss:

1. User nutzt die Next.js Web-App.
2. Web-App spricht mit der Express API.
3. API nutzt Prisma/Postgres, Redis, Exchange APIs, HyperEVM/Hyperliquid und interne Services.
4. Runner verarbeitet Bot-Ausfuehrung, Grid-Order-Loop, Recovery und Reconciliation.
5. Contracts unterstuetzen BotVault/FundingVault-Onchain-Funding, Claims, Close und Recovery.

## Monorepo Struktur

- `apps/web`
  Next.js Web-App. Enthalten sind App-Routes, Dashboard, Trading Desk, Bots, Grid Catalog, Predictions, Wallet/Funding, Admin UI, i18n, CSS und gemeinsame UI-Komponenten.
- `apps/api`
  Express API mit Auth, Admin, Billing, AI, Predictions, Trading, Exchange-Accounts, Vaults, Grid, Jobs, Telegram, Calendar, News und Prisma-Service-Logik.
- `apps/runner`
  Worker fuer Bot-Runtime, Grid-Execution, Prediction-Copier, Reconciliation, Recovery und Runtime-Monitoring.
- `apps/py-strategy-service`
  Python-Service fuer lokale/remote Strategy-Execution und Strategy-Registry.
- `apps/quant-research`
  Research-/Analysebereich fuer quantitative Experimente.
- `packages/contracts`
  Foundry Contracts und Deploy-Scripts, unter anderem BotVault/FundingVault relevante Solidity-Arbeit.
- `packages/futures-exchange`
  Exchange-Adapter und Futures-Exchange-Interfaces, unter anderem Bitget/Hyperliquid-Positionen, Orders, Funding und Transfers.
- `packages/futures-core`
  Gemeinsame Futures-Domain-Typen und Kernlogik.
- `packages/futures-engine`
  Trading-/Execution-Engine-Bausteine.
- `packages/exchange`
  Allgemeinere Exchange-Abstraktionen.
- `packages/core`
  Gemeinsame Core-Helfer, Lizenz-/HMAC-nahe Utilities und Shared Types.
- `packages/db`
  Datenbanknahe gemeinsame Utilities.
- `packages/strategies`
  Strategy-Typen, Registry- und Strategie-Helfer.
- `packages/risk`
  Risiko- und Guardrail-Logik.
- `packages/orchestrator`
  Orchestrierungsbausteine fuer Jobs/Bots/Runtime.
- `packages/plugin-sdk`
  Plugin-SDK und Typen, auch relevant fuer API/Runner-Typechecks.
- `prisma`
  Prisma Schema und Migrations. Neue persistierte Datenmodelle muessen hier sauber migriert werden.
- `docs`
  Go-live, Operations, Architektur, User Guide, CEX-Docs, Tasks und Referenzen.
- `scripts`
  Build, Deploy, VPS, Env-Sync, Regression und Qualitaets-Skripte.
- `infra`
  Infrastruktur- und Deployment-nahe Dateien.

## Wichtige Web-Bereiche

- `apps/web/app/page.tsx`
  Haupt-Dashboard.
- `apps/web/app/trade/page.tsx`
  Trading Desk, Orderticket, Account Summary, Positions-/Prefill-nahe UI.
- `apps/web/app/positions` oder positionsnahe Komponenten
  Positionsansichten, Risk-Felder wie Leverage, Margin, ROE, Liquidation.
- `apps/web/app/bots`
  Normale Bots, Bot-Details, Bot Settings.
- `apps/web/app/bots/grid`
  Laufende Grid-Bots und Grid Runtime UI.
- `apps/web/app/bots/catalog`
  GridBot-Katalog, Launch Drawer, Funding Source, BotVault/FundingVault Startflow.
- `apps/web/app/predictions`
  Prediction Dashboard, Auto-Predictions, AI/Local/Composite Strategy Auswahl.
- `apps/web/app/settings`
  User Settings, Subscription, Wallet-/Account-nahe Einstellungen.
- `apps/web/app/admin`
  Platform Admin Shell, User/License/Billing/Admin-System/Vault/AI/Grid-Template Admin.
- `apps/web/app/components`
  Gemeinsame App-Shell, Sidebar, Breadcrumbs, `AppIcon`, Header, Dashboard Widgets.
- `apps/web/app/styles`
  Feature-CSS: `shell.css`, `desk.css`, `bots-wallet.css`, `settings-admin.css`.
- `apps/web/app/ui-system.css`
  Globale UI-Primitives und Design-System-Kompatibilitaet.
- `apps/web/messages`
  next-intl Messages. Bei sichtbaren Texten i18n-Muster beachten.

## Wichtige API-Bereiche

- `apps/api/src/bootstrap.ts`
  API Entry/Bootstrap.
- `apps/api/src/index.ts`
  Haupt-Wiring und viele Legacy-/Core-Routen. Bei grossen Aenderungen bevorzugt neue Module nutzen statt weiter aufzublaehen.
- `apps/api/src/admin`
  Platform Admin Routen, Vault Ops, Operations, Alerts, Admin-System.
- `apps/api/src/auth`
  Auth, SIWE, Permissions, Superadmin/Admin-Zugriff.
- `apps/api/src/billing`
  Billing, Packages, Orders, CCPayment.
- `apps/api/src/exchange-accounts`
  Exchange Account Verwaltung, Credential Health, Venue-Konfiguration.
- `apps/api/src/grid`
  Grid Templates, Grid Instances, Lifecycle, Fills, Orders.
- `apps/api/src/vaults`
  BotVault, Funding, Profitshare, Reconciliation, Onchain Indexer, Recovery, Safety Controls.
- `apps/api/src/ai`
  AI Provider, Prompt Settings, Analyzer, Quality Gate, Tools.
- `apps/api/src/predictions`
  Prediction Refresh, State, Health und Evaluator-nahe Logik.
- `apps/api/src/jobs`
  Background Jobs fuer Evaluator, Vault Accounting, Reconciliation, Telegram Health usw.
- `apps/api/src/telegram`
  Telegram Link, Delivery und Notification-nahe Logik.
- `apps/api/src/system`
  System-/Health-/Ops-nahe Routen.

## Wichtige Runner-Bereiche

- `apps/runner/src/bootstrap.ts`
  Runner Entry.
- `apps/runner/src/execution`
  Execution Modes, Grid Runtime, Vault Readiness, Risk Guards, Recovery, Agent Secret Provider.
- `apps/runner/src/grid`
  Grid Fill Sync und Grid-spezifische Runtime-Helfer.
- `apps/runner/src/runtime`
  Runtime-Reconciliation und Bot Runtime Status.
- `apps/runner/src/plugins`
  Plugin-Aufloesung und Erweiterungspunkte.
- `apps/runner/src/signal`
  Signal Engines und Prediction-Copier-nahe Pfade.

## Wichtige Contract-/Onchain-Bereiche

- `packages/contracts/src`
  Solidity Contracts.
- `packages/contracts/script`
  Foundry Deploy-/Script-Dateien.
- `packages/contracts/test`
  Foundry Tests.
- `docs/contracts-vps-deploy.md`
  VPS Deploy-Kontext fuer Contracts.
- `scripts/deploy_contracts_vps.sh`
  Deploy Helper fuer VPS.

BotVault/FundingVault Aenderungen betreffen fast immer mehrere Schichten:

- Contracts in `packages/contracts`
- Prisma Models/Migrations in `prisma`
- API Services/Routen in `apps/api/src/vaults` und `apps/api/src/grid`
- Runner Readiness/Execution in `apps/runner/src/execution`
- Web UI in `apps/web/app/bots`, `apps/web/app/wallet` und Admin Vault-Ops
- Go-live/Runbook-Dokumentation in `docs`

## Feature-Karte

### Admin

- Web: `apps/web/app/admin`
- API: `apps/api/src/admin`
- Styles: `apps/web/app/styles/settings-admin.css`
- Gemeinsame Admin-Komponenten: `apps/web/app/admin/_components`
- System-Unterbereiche: Access, Notifications, Integrations, AI Controls, Bots/Strategies, Vault Controls.

### Trading & Positions

- Web: `apps/web/app/trade`, positionsnahe Views, Dashboard Widgets.
- API: Trading-/Exchange-Routen in `apps/api/src/index.ts`, Exchange Accounts, Futures Services.
- Exchange Adapter: `packages/futures-exchange/src`.
- Bei neuen Positionsfeldern immer exchangeuebergreifend denken: Bitget, Hyperliquid, Paper/Mock, spaeter weitere CEX.

### Bots & Grid Bots

- Web: `apps/web/app/bots`, `apps/web/app/bots/grid`, `apps/web/app/bots/catalog`.
- API: `apps/api/src/grid`, `apps/api/src/vaults`, Grid-Routen in `apps/api/src/index.ts`.
- Runner: `apps/runner/src/execution`, `apps/runner/src/grid`.
- Python Strategy: `apps/py-strategy-service`.

### AI, Predictions & Strategies

- Web: `apps/web/app/predictions`, Admin AI Seiten, Strategy Builder.
- API: `apps/api/src/ai`, `apps/api/src/predictions`, Local Strategy Routen.
- Strategies Package: `packages/strategies`.
- Python Service: `apps/py-strategy-service/strategies`.

### Wallet, Funding, Vaults

- Web: Wallet/Funding Seiten, Bot Catalog Launch Drawer, Dashboard Wallet Widget.
- API: `apps/api/src/vaults`, Transfer-/Funding-/Grid Lifecycle Services.
- Contracts: `packages/contracts`.
- Runner: Vault readiness and funding handling in `apps/runner/src/execution`.

### Billing, Licenses, Affiliate

- Web: `apps/web/app/settings/subscription`, `apps/web/app/admin/billing`, Admin Licenses/Affiliate.
- API: `apps/api/src/billing`, License/Admin Routen.
- Prisma: License, Subscription, Billing Order, Affiliate Models.

### Calendar, News, Telegram, Monitoring

- Web: `apps/web/app/calendar`, `apps/web/app/news`, Settings/Admin notification pages.
- API: Calendar/News/Telegram/System Health Routen und Jobs.
- Ops Docs: `docs/ops`, Go-live Docs.

## Design- und UI-Regeln fuer Agenten

- Fuer Web-UI-Arbeit den Skill `apply-uliquid-ui-design` verwenden.
- Keine neuen Inline-SVGs fuer normale UI-Icons. `AppIcon` aus `apps/web/app/components/AppIcon.tsx` nutzen.
- Buttons fuer wichtige Aktionen mit Icons versehen.
- Bestehende UI-Primitives bevorzugen: `uiPage`, `uiSection`, `card`, `btn`, `btnPrimary`, `AdminPageHeader`, `AdminTable`, `AdminNotice`.
- Admin-Seiten sollen konsistente Breite, linke Ausrichtung und gemeinsame Admin-Komponenten nutzen.
- Keine echten Secrets in Code, Docs oder Commits schreiben.
- Routes, API-Response-Shapes und Berechtigungslogik nicht ohne konkreten Grund veraendern.

## Entwicklungsregeln

- Package Manager: nur `npm`, kein `pnpm` oder `yarn`.
- Node Ziel: `>=20.9.0 <21`.
- Prisma Client vor Root-Build/Typecheck generieren, Root-Skripte erledigen das teilweise automatisch.
- Fuer Datei-Aenderungen in Agentenarbeit `apply_patch` verwenden.
- Keine destruktiven Git-Befehle wie `git reset --hard` oder `git checkout --`, ausser der User verlangt es eindeutig.
- Vor Loeschungen mit `rg` pruefen, ob Referenzen existieren.
- Bei Exchange- oder Money-Flow-Aenderungen Rueckwaertskompatibilitaet und Idempotency beachten.

## Typische Checks

Root:

```bash
npm run typecheck
npm run build
npm run quality:any-budget
npm run quality:vendor-charting
```

Web:

```bash
npm -w apps/web run typecheck
npm -w apps/web run i18n:check
```

API:

```bash
npm -w apps/api run typecheck
npm -w apps/api run test:auth
npm -w apps/api run test:ai
npm -w apps/api run test:vaults
npm -w apps/api run test:grid-corewriter
```

Runner:

```bash
npm -w apps/runner run typecheck
npm -w apps/runner run test
npm -w apps/runner run test:vault-grid-corewriter
```

Contracts:

```bash
npm run contracts:build
npm run contracts:test
```

Python Strategy Service:

```bash
PY_STRATEGY_AUTH_TOKEN=test-token PY_GRID_AUTH_TOKEN=test-token PYTHONPATH=apps/py-strategy-service pytest -q apps/py-strategy-service
```

Repo Hygiene:

```bash
git diff --check
git status --short
rg "window\\.confirm|confirm\\(" apps/web/app/admin -g '*.tsx'
```

## Lokaler Betrieb

Docker Dev Stack:

```bash
npm run docker:dev:up
npm run docker:dev:logs
```

Direkt lokal:

```bash
npm run dev:local
npm run dev:local:runner
npm run dev:web
npm run dev:api
```

Health:

```bash
curl -i http://localhost:${API_PORT:-4000}/health
```

## Production/VPS Orientierung

- Production Compose: `docker-compose.prod.yml`
- VPS Install: `scripts/install_vps.sh`
- Production Deploy: `scripts/deploy_prod.sh`
- Env Sync: `scripts/sync_env_files.sh`
- Contracts VPS Deploy: `scripts/deploy_contracts_vps.sh`
- Production Docs: `docs/PRODUCTION_DEPLOY.md`, `docs/contracts-vps-deploy.md`, `docs/ops`
- Kanonische Domains laut README:
  - Web: `https://desk.uliquid.vip`
  - API: `https://api.desk.uliquid.vip`

## Go-Live Dokumente

- `docs/go-live-master-plan.md`
- `docs/go-live-readiness-followups.md`
- `docs/ops/go-live-and-smoke-tests.md`
- `docs/release-evidence-matrix.md`
- `AGENDA.md` fuer release-gate-orientierte Historie

## Wenn ein Agent neu startet

1. `git status --short --branch` pruefen.
2. Relevante Feature-Dateien mit `rg` suchen statt zu raten.
3. Nahe Komponenten/CSS/Tests lesen.
4. Kleine, scoped Aenderung machen.
5. Passende Checks aus dieser Datei laufen lassen.
6. Ergebnis knapp dokumentieren und offene Risiken nennen.
