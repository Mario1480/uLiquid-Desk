# Go-live Master Plan

Stand: 2026-07-28

Lokaler Review-Nachtrag 2026-07-28: Die technische Remediation ist unter `docs/tasks/2026-07-28-project-review-remediation.md` dokumentiert. BotVault V3 ist nach Betreiberbestätigung aus der regulären Factory-/Treasury-/Reconciliation-Auswahl entfernt. Dieser lokale Nachtrag ersetzt keine noch offene Production-, Canary-, Alert- oder 24–48-h-Betriebsevidenz.

## Ziel

Dieses Dokument buendelt die offenen Go-live-Bereiche aus den bestehenden Statusdateien in einen abarbeitbaren Master-Plan. Der Plan ist bewusst in Gates aufgebaut: Ein breiter Go-live sollte erst erfolgen, wenn die harten Gates gruen sind und mindestens ein kontrollierter Canary ausgewertet wurde.

## Status-Legende

| Status | Bedeutung |
| --- | --- |
| `OPEN` | Noch nicht begonnen oder noch nicht verifiziert. |
| `IN_PROGRESS` | Wird gerade umgesetzt oder getestet. |
| `BLOCKED` | Haengt an externer Voraussetzung, Umgebung oder Entscheidung. |
| `DONE` | Erledigt und dokumentiert/verifiziert. |
| `ACCEPTED_RISK` | Bewusst fuer Canary/Go-live akzeptiert, mit Owner und Monitoring. |

## Go-live Gates

| Gate | Ziel | Status | Exit-Kriterium |
| --- | --- | --- | --- |
| Gate 1: Build & Infra | Repo, Build, Secrets, Migration und Docker/VPS sind releasefaehig. | `DONE` | Production-Build, Typechecks, Migration-Smoke, Docker/Caddy-Smoke sowie Secret-Finalisierung/Rotation sind gruen. |
| Gate 2: Security/Auth/RBAC | Zugriffsschutz und Security-Flows sind in echter Umgebung geprueft. | `IN_PROGRESS` | Superadmin/Admin-Backend-Access ist Betreiber-verifiziert; voller Auth- und RBAC-Rollenmatrix-Smoke bleibt nachzuhalten. |
| Gate 3: Read-only Produktflaechen | Dashboard, Calendar, News und AI Reads failen sichtbar/degraded statt falsch offen. | `IN_PROGRESS` | Dashboard-, Calendar-, News-, AI- und Read-only-Monitoring-Smokes sind am 2026-05-06 Betreiber-verifiziert; Dashboard-RBAC-Rollenmatrix bleibt unter Gate 2 nachzuhalten. |
| Gate 4: Trading Canary | Manuelles Trading ist mit kleinen Limits live getestet. | `OPEN` | Paper-Smoke, Live-Canary, Idempotency- und Close-Sync-Smokes bestanden. |
| Gate 5: Wallet/Grid/BotVault Canary | Capital-Flows und Grid/Vault-Reconciliation laufen kontrolliert. | `IN_PROGRESS` | Wallet/User-funded BotVault V4 Start/Close sowie FundingVault-backed Start sind low-value live belegt; offen bleiben Roh-Wallet-Transfer-Smokes, Profit-Claim/Recovery-Szenarien, Alert-/Runbook-Probe und 24-48h Beobachtung. |
| Gate 6: Beobachtung & Freigabe | Canary-Daten wurden 24-48h ausgewertet. | `OPEN` | Keine offenen P1/P2-Runtime-Bugs, Runbooks angepasst, Freigabeentscheidung dokumentiert. |

## Phase 1: Build, Repo und Infra

| Aufgabe | Quelle | Status | Verifikation / Command | Notizen |
| --- | --- | --- | --- | --- |
| Node `>=20.9.0` fuer Web-Build/Typecheck lokal, CI und Server fixieren. | Admin, Trading, AI | `DONE` | `node -v`; `npm -w apps/web run typecheck` | VPS-Host nutzt Node `v20.20.2`/npm `10.8.2`; API/Web/Runner-Container nutzen Node `v20.20.1`. NodeSource-APT-Kanal ist auf `node_20.x` gesetzt. |
| Full-Web-Typecheck ausfuehren. | Admin | `DONE` | `npm -w apps/web run typecheck` | PASS am 2026-05-05 nach `npm ci`; Next-Typegen aktualisierte `apps/web/next-env.d.ts` auf `.next/types/routes.d.ts`. |
| Production-Build frisch ausfuehren. | Readiness | `DONE` | `npm ci`; `npm run build` oder Docker-Build | PASS am 2026-05-05: `docker compose --env-file .env.prod -f docker-compose.prod.yml build api web runner py-strategy-service`. Images gebaut, laufende Container wurden dabei nicht neu gestartet. |
| API-Typecheck und relevante Tests erneut laufen lassen. | Admin/Readiness | `DONE` | `npm -w apps/api run typecheck`; gezielte Test-Suites | PASS nach frischem `npm ci` und Rebuild lokaler Workspace-Dist-Typen (`@mm/exchange`, `@mm/futures-exchange`). `npm -w apps/api run test:auth`: 19/19 PASS. |
| Duplicate-Dateien final bereinigen/stagen. | Admin | `DONE` | `git status --short`; nach Commit: `git ls-files '* 2.tsx' '* 2.ts'` | Keine getrackten `* 2.tsx`/`* 2.ts`/`* 2.js`/`* 2.jsx` Duplikate mehr. |
| Production-Secrets final setzen. | Readiness | `DONE` | `.env.prod`/Deployment-Secret-Check | Betreiber-verifiziert am 2026-05-06. Alle final benoetigten Production-Secrets sind ausserhalb des Repos gesetzt; keine Secret-Werte werden dokumentiert. |
| Secret-Rotation planen und durchfuehren. | Readiness | `DONE` | Rotationsprotokoll | Betreiber-verifiziert am 2026-05-06. Rotation wurde geplant und durchgefuehrt beziehungsweise fuer bewusst akzeptierte Secrets dokumentiert. |
| Staging/Production-Migration mit Backup testen. | Readiness/AI | `DONE` | DB-Backup; `prisma migrate deploy` | PASS am 2026-05-05: Backup erstellt, Restore-Probe erfolgreich, `prisma migrate deploy` meldet 90 Migrations und keine Pending Migrations. Workspace-/Rollen-Smokes bleiben in Phase 2. |
| Docker/Caddy/VPS-Smoke. | Readiness/Trading | `DONE` | `docker compose -f docker-compose.prod.yml config`; `/health` | PASS am 2026-05-05: Compose config und Caddy validate gruen; API `/health` lokal und public `200`; Web HEAD public `307`; extern offen nur SSH/HTTP/HTTPS, API/Web nur auf `127.0.0.1`. |
| Backup-/Restore-Probe. | Readiness | `DONE` | Restore-Testprotokoll | PASS am 2026-05-05: `/var/backups/uliquid-desk/phase1/marketmaker-20260505T171045Z.dump` (87M), SHA256 `f51bdd6a5c88046e2597faf8bcac57579ca6f175417936ad5f08b315ca21ca6f`, Restore-Probe 87 Public Tables, Probe-DB wieder geloescht. |

## Phase 2: Security, Auth und RBAC

| Aufgabe | Quelle | Status | Verifikation | Notizen |
| --- | --- | --- | --- | --- |
| Auth-Smoke in echter Umgebung. | Readiness | `IN_PROGRESS` | Live-Probes 2026-05-05; Admin-Backend-Verifikation 2026-05-06; `npm -w apps/api run test:auth` | Admin-Backend-Access ist am 2026-05-06 Betreiber-verifiziert. Voller Register/Email-Verify/Login/Reset-Smoke mit Owner-Test-Mailbox bleibt separat nachzuhalten; Auth-Tests 19/19 PASS. |
| Rate-Limit-Smoke. | Readiness | `DONE` | Live-Probe 2026-05-05: 9 Login-Versuche auf neue Smoke-Mail | Request 9 liefert `429 { error: "rate_limited", retryAfterSec: 598 }`; API-Log enthaelt `api_rate_limit_blocked` fuer `auth_login_account`. |
| RBAC-Smoke mit Rollenmatrix. | Readiness/Dashboard/Admin | `IN_PROGRESS` | `node node_modules/tsx/dist/cli.mjs --test apps/api/src/rbac.test.ts apps/api/src/auth/permissions.test.ts apps/api/src/auth/superadmin.test.ts apps/api/src/admin/routes-platform.test.ts` | Code-/Rollenmatrix 14/14 PASS; erweiterter Auth/Admin/Webhook-Testlauf 35/35 PASS. Live-Positive/Negative-RBAC ueber Admin/User/Viewer bleibt als eigener Rollen-Smoke offen. |
| Superadmin/Admin-Backend-Access pruefen. | Admin | `DONE` | Live-Probe; Superadmin-Tests | Betreiber-verifiziert am 2026-05-06. Superadmin/Admin-Backend-Access ist produktionsnah geprueft; Parser fuer einzelne und kommaseparierte Admins bleibt testgedeckt. |
| Webhook-Smoke inklusive SSRF-Schutz. | Readiness | `IN_PROGRESS` | `node node_modules/tsx/dist/cli.mjs --test packages/core/src/outboundSecurity.test.ts`; Notification-Plugin-Tests | Core-SSRF-Tests 3/3 PASS: HTTPS-Pflicht in Production, localhost und link-local/private IPs blockiert; Webhook-Plugin nutzt `validateSafeOutboundUrl`, `sanitizeOutboundHeaders` und `redirect: "error"`. Live-Smoke mit echter HTTPS-Webhook-URL/Test-Receiver bleibt offen. Header-Blocklist blockiert Hop-by-hop/Proxy/Sec/X-Forwarded-Header; `Authorization` wird aktuell bewusst durchgelassen, falls Webhook-Ziel Auth-Header braucht. |

Phase-2-Laufnotizen 2026-05-05:
- API `/health` ist public `200` und der Container ist aktuell `healthy`.
- Beim Phase-2-Smoke war ein API-Restart sichtbar (`restart_count=2`); API-Logs zeigten davor Prisma `P1001` gegen `postgres:5432`. Postgres ist aktuell wieder erreichbar, Ursache nicht abschliessend geklaert.
- SMTP ist ueber Environment nicht vollstaendig gesetzt (`SMTP_PASS` leer), es existiert aber ein DB-basierter `admin.smtp`-Eintrag mit verschluesseltem Passwort. Ein echter Email-Delivery-Smoke wurde noch nicht ohne Owner-Testadresse ausgefuehrt.

Phase-2-Nachtrag 2026-05-06:
- Production-Secrets final gesetzt und Secret-Rotation geplant/durchgefuehrt. Die SMTP-/Telegram-/Provider-Secret-Lage aus den 2026-05-05-Laufnotizen ist damit fuer den aktuellen Betreiber-Stand ueberholt; Secret-Werte bleiben ausserhalb der Doku.

## Phase 3: Dashboard, Calendar, News und AI Reads

| Aufgabe | Quelle | Status | Verifikation | Notizen |
| --- | --- | --- | --- | --- |
| Dashboard Open Positions gesund/degraded testen. | Dashboard | `DONE` | `src/dashboard/routes.test.ts`; Live-Smoke | Betreiber-verifiziert am 2026-05-06. Gesunde Venue-Reads und degraded/failed Reads wurden produktionsnah getestet; Fail-closed-Semantik bleibt testgedeckt. |
| Dashboard RBAC-Smoke. | Dashboard | `OPEN` | Live-Probe 2026-05-05: `/dashboard/open-positions`, `/dashboard/overview`, `/economic-calendar`, `/news`, `/api/predictions` ohne Cookie | Alle getesteten Read-only-Routen liefern ohne Session `401 unauthorized`. Positiv-/Negativtest mit Rollenrechten bleibt als eigener RBAC-Rollenmatrix-Smoke offen. |
| Calendar-Smoke mit echtem FMP-Key. | Dashboard | `DONE` | `src/routes/economic-calendar.test.ts`; DB-/Config-/Live-Smoke | Betreiber-verifiziert am 2026-05-06 mit echtem FMP-Key. Date-Range, Limits, `truncated` und `/economic-calendar/next` bleiben testgedeckt. |
| News-Risk Blocking-Smoke. | Dashboard | `DONE` | `src/services/economicCalendar/index.test.ts`; `src/predictions/routes-generate.test.ts`; Live-Smoke | Betreiber-verifiziert am 2026-05-06. News-Risk-Blocking und degraded Calendar-State wurden produktionsnah geprueft. |
| AI Provider-Konfig-Smoke. | AI | `DONE` | `src/ai/provider.config.test.ts`; DB-/Proxy-/Provider-Smoke | Betreiber-verifiziert am 2026-05-06. AI Provider-Konfiguration ist produktionsnah geprueft; Outbound-Sicherheitschecks bleiben testgedeckt. |
| AI Refresh-Degraded-Smoke in API und UI. | AI | `DONE` | `src/predictions/refreshHealth.test.ts`; `src/predictions/refreshService.test.ts`; `apps/web/src/predictions/refreshUi.test.ts`; API/UI-Smoke | Betreiber-verifiziert am 2026-05-06. Degraded Refresh wird in API und UI sichtbar und bleibt testgedeckt. |
| AI Evaluator-Stichprobe gegen Candle-Daten. | AI | `DONE` | `src/jobs/predictionEvaluatorJob.test.ts`; `src/predictions/evaluationFramework.test.ts`; Candle-Stichprobe | Betreiber-verifiziert am 2026-05-06. Evaluator-Stichprobe gegen Candle-Daten wurde produktionsnah geprueft. |
| Monitoring fuer Read-only Flaechen aktivieren. | Dashboard/AI | `DONE` | `src/admin/externalHealth.test.ts`; `src/jobs/systemHealthTelegramJob.test.ts`; API-Logs/Alerts | Betreiber-verifiziert am 2026-05-06. Monitoring fuer Read-only Flaechen ist aktiv; Delivery- und Alert-Pfade bleiben im Betrieb weiter zu beobachten. |

Phase-3-Laufnotizen 2026-05-05:
- API-Read-only-Routen sind public nicht offen: getestete Dashboard-, Calendar-, News- und Prediction-Routen liefern ohne Cookie `401 unauthorized`.
- Phase-3-Testlauf PASS: 97/97 API-Tests fuer Dashboard, Calendar, News, AI-Provider, AI-Refresh, News-Risk und Evaluator; Web-Refresh-UI 4/4 PASS; External/System-Health 8/8 PASS.
- Fix umgesetzt: `apps/api/src/ai/provider.config.test.ts` neutralisiert AI-private-Base-URL-Env-Flags temporaer, damit Security-Tests auf dem VPS deterministisch bleiben.

Phase-3-Nachtrag 2026-05-06:
- Betreiber-verifiziert und als erledigt markiert: Dashboard Open Positions gesund/degraded, Calendar-Smoke mit echtem FMP-Key, News-Risk Blocking-Smoke, AI Provider-Konfig-Smoke, AI Refresh-Degraded-Smoke in API und UI, AI Evaluator-Stichprobe gegen Candle-Daten und Monitoring fuer Read-only Flaechen.
- Dashboard-RBAC-Rollenmatrix bleibt separat unter Phase 2 nachzuhalten, sofern nicht mit eigenen Rollen-Smoke-Protokollen abgeschlossen.

## Phase 4: Trading Desk Canary

| Aufgabe | Quelle | Status | Verifikation | Notizen |
| --- | --- | --- | --- | --- |
| Paper-Smoke vollstaendig. | Trading | `OPEN` | Orders, Positions, Cancel-All, Close, degraded Reads | Muss vor Live-Canary gruen sein. |
| Degraded Market-Data-Smoke. | Trading | `OPEN` | `/api/positions` und `/api/orders/open` liefern `503 market_data_degraded` | UI haelt letzte bekannte Daten und sperrt Aktionen. |
| Idempotency-Smoke. | Trading | `OPEN` | Fehlender Key `400`; paralleler gleicher Key `409` | Browser-Doppelklick darf keine zweite Live-Order ausloesen. |
| Kleiner Live-Canary. | Trading | `OPEN` | Minimalbetrag gegen echte Venue | Nur interne/Admin-Accounts. |
| Close-Sync-Smoke. | Trading | `OPEN` | Restposition, Flat-Read, `pending_live_position` | Keine interne Flat-Markierung ohne bestaetigten Live-Read. |
| Trading Monitoring aktivieren. | Trading | `OPEN` | `market_data_degraded`, `pending_live_position`, `sync_skipped_read_failed`, Order-Fehlerquote | Alerts mit Owner. |
| Trading Operator-Runbook finalisieren. | Trading | `OPEN` | Runbook fuer Pending Close/Sync, manuellen Abgleich, Reconcile vs Eingriff | Muss fuer Canary verfuegbar sein. |

## Phase 5: Wallet, Funding, GridBot und BotVault Canary

| Aufgabe | Quelle | Status | Verifikation | Notizen |
| --- | --- | --- | --- | --- |
| Wallet Funding Deposit Canary. | Wallet/Funding | `OPEN` | Arbitrum USDC -> Intent -> pending -> Hyperliquid credited target -> confirmed | Generischer Rohfluss bleibt offen; BotVault-bezogenes Wallet/User-Funding ist live belegt. |
| Wallet Funding Withdraw Canary. | Wallet/Funding | `OPEN` | Hyperliquid withdrawable -> pending -> Arbitrum Zielbalance -> confirmed | Generischer Rohfluss bleibt offen; BotVault-Close/Settlement ist live belegt. |
| Core/EVM und Spot/Perp Transfer Canary. | Wallet/Funding | `OPEN` | Zielbalance-Anstieg um angefragten Betrag | Pending blockiert gleichen Flow bis Abschluss. |
| Pending-Intent Cleanup/Expiry entscheiden. | Wallet/Funding | `OPEN` | Manuell akzeptiert oder Job/Runbook vorhanden | Aktuell konservativ manuell. |
| BotVault Wallet/User-funded Start/Close Canary. | BotVault/Grid | `DONE` | HyperEVM create/fund -> HyperCore -> Perp/HYPE reserve -> Grid running -> Close/settled | Low-value Production-Evidence in `docs/tasks/2026-05-21-botvaultv4-gridbot-live-monitoring.md` und `docs/tasks/2026-05-23-botvaultv4-gridbot-live-monitoring.md`; laut Betreiber-Stand 2026-05-25 ohne bekannten Start/Stop-Fehler. |
| BotVault FundingVault-backed Start Canary. | BotVault/FundingVault/Grid | `DONE` | FundingVault operator ok -> launch -> reserve release -> execution ready -> Grid running | Erfolgreicher Production-Run am 2026-05-25 dokumentiert in `docs/tasks/2026-05-25-funding-vault-live-start.md`. Erster Fehler war Operator-Mismatch, kein BotVault-Code-Blocker. |
| BotVault Funding/Reconcile Recovery Canary. | BotVault | `IN_PROGRESS` | Pending Deposit/Withdraw, HYPE Reserve, Contract Balance, Claim/Close/Recover | Start/Close sind live belegt; Profit-Claim, bewusst erzeugte Spot-to-EVM Pending-Recovery und FundingVault-backed Close sollten noch als eigene Evidence nachgezogen werden. |
| Bestehende Vaults normalisieren/pruefen. | BotVault | `OPEN` | Reconcile-Job oder Migration fuer alte Mischzustaende | Alte v3 Reads kompatibel halten, neue Writes v4-normalisiert. |
| GridBot Funding/Seed/Recovery Canary. | GridBot | `IN_PROGRESS` | Funding, Seed-Pending, Restart-Recovery, Cancel-Reconcile, Fill/PnL-Reconcile | Funding und Initial Seed sind live belegt; Restart-/Cancel-/Recovery-Langlauf ueber mehrere Marktzyklen bleibt offen. |
| Canary-Limits technisch setzen. | GridBot/BotVault | `OPEN` | Max Vault-Groesse, parallele Bots, Pending-Dauer | Kleine Limits fuer ersten Live-Betrieb. |
| Monitoring fuer Pending/Failed/Reconcile aktivieren. | Wallet/Grid/BotVault | `IN_PROGRESS` | Deposit/Withdraw/Funding pending, failed retry/final, Reconcile-Job, RPC rate limit | PlatformAlerts fuer Deposit/Withdraw/Contract-Balance/Reconcile-Job sind umgesetzt; Failed-Final/Low-HYPE Matrix, RPC Rate-Limit-Metriken und Schwellen muessen im Canary feinjustiert werden. |
| Admin-Operational-View pruefen/erweitern. | BotVault/Grid/Admin | `IN_PROGRESS` | `reasonCode`, `recoveryHint`, `txHash`, `idempotencyKey`, Account-State-Zeitpunkt, Startup-Timeline | Reconciliation Summary liefert Money-Flow-Details und offene Alert-IDs; Admin Startup-Timeline, FundingVault Operator-Mismatch und echter Admin-Smoke bleiben offen. |

Phase-5-Laufnotizen 2026-05-06:
- Code-Hardening aus der BotVault-Go-live-Analyse ist umgesetzt: `pending_reconciliation`, `funding_pending`, Zielbalance-Sicherung fuer Spot-to-EVM, Trading-Reconciliation-Freshness, granulare Safety-Controls, Money-Flow-Alerts und Admin-Vault-Ops-Details.
- Verifikation PASS: Futures-Exchange 64/64, Runner Vault/Grid 127/127, API v4-Transitions 15/15, API Vault/Grid Corewriter 9/9, breite Vault-Suite 214/214, API/Runner/Web-Typechecks und `git diff --check`.
- Offen bleibt der echte Kapital-Canary inklusive Alert-Schwellen, Low-HYPE-/Failed-Final-Matrix, Runbook-Probe und Admin-Live-Smoke.

Phase-5-Nachtrag 2026-05-25:
- Wallet/User-funded BotVault V4 Starts liefen am 2026-05-23 mehrfach bis
  `running`; Initial Seed und Folgeorders wurden live beobachtet.
- Wallet/User-funded Close/Settlement wurde am 2026-05-21 dokumentiert und
  endete mit `execution_status=closed`, `funding_status=settled`,
  `hypercore_funding_status=withdrawn` und Reconciliation `ok`.
- FundingVault-backed BotVault V4 Launch lief am 2026-05-25 nach Operator-
  Rotation bis BotVault/Grid `running`; initiale Fehlversuche waren
  `only_operator` wegen onchain/DB Operator-Mismatch.
- Nach dem FundingVault-Run wurden RPC Rate-Limit-Backoff, Indexer-
  Aktionspriorisierung und Reconciliation-Priorisierung verbessert.
- Damit ist der bekannte BotVault-V4 Start/Stop-Pfad fuer kleine interne
  Canaries nicht mehr der Hauptblocker. Offen bleiben generische
  Wallet-Transfer-Smokes, Profit-Claim-/Recovery-Evidence, FundingVault
  Operator-Preflight, Alert-Delivery/Runbook-Probe, Contract-Readiness und
  24-48h Betriebsauswertung.

## Phase 6: Normal Bots

| Aufgabe | Quelle | Status | Verifikation | Notizen |
| --- | --- | --- | --- | --- |
| Produktiven Signal-Adapter pro Strategie anbinden. | Normal Bots | `OPEN` | Bot ohne Signalpfad blockiert; Bot mit Signalpfad erzeugt Open-Intent | Keine stillen DummyStrategy-Live-Laeufe. |
| Live-Execution-Adapter pruefen. | Normal Bots | `OPEN` | Fehlender Adapter blockiert mit `execution_adapter_unavailable` | Kein alter Noop-Adapter im Live-Betrieb. |
| Pending Order Reconciliation testen. | Normal Bots | `OPEN` | Restart/Tick sendet keine zweite Order | Deterministischer `clientOrderId`. |
| Fill-Reconciliation erweitern/akzeptieren. | Normal Bots | `OPEN` | Position/FIll-Reconcile bestaetigt Entry/Close | Aktuell Position-State konservative Quelle. |
| UI-Recovery-Hinweise fuer normale Bots. | Normal Bots | `OPEN` | `strategy_runtime_not_available`, `pending_order_reconciliation`, `pending_fill_confirmation` | Vor breiterer Freigabe nutzerfreundlich machen. |

## Phase 7: Canary-Betrieb und Freigabe

| Aufgabe | Quelle | Status | Verifikation | Notizen |
| --- | --- | --- | --- | --- |
| Canary-Kreis und Limits festlegen. | Readiness/BotVault/Grid/Trading | `OPEN` | Interne/Admin-Accounts, kleine Trading-/Vault-Limits | Kein Big-Bang. |
| 24-48h Monitoring-Auswertung. | Alle | `OPEN` | Alert-Review, Fehlerklassen, Latenzen, Pending-Zustaende | Danach Schwellen/Runbooks nachschaerfen. |
| Offene Risiken bewusst entscheiden. | Alle | `OPEN` | `DONE` oder `ACCEPTED_RISK` mit Owner | Keine stillen offenen P1/P2-Risiken. |
| Breite Go-live-Freigabe dokumentieren. | Alle | `OPEN` | Freigabeprotokoll mit Datum, Commit, Checks, Rollback-Pfad | Erst nach Canary-Auswertung. |

## Empfohlene Reihenfolge fuer die naechsten Arbeitspakete

1. **Auth/RBAC/Webhook finalisieren**
   - Register/Email-Verify/Login/Reset-Smoke
   - Admin/User/Viewer-Rollenmatrix positiv und negativ
   - Webhook-Smoke mit echtem HTTPS-Test-Receiver

2. **Read-only Smokes weiter beobachten**
   - Dashboard/Open-Positions, Calendar/News, AI Provider/Refresh/Evaluator sind am 2026-05-06 erledigt
   - Monitoring-Signale und Alert-Zustellung im Betrieb beobachten

3. **Riskante Canary-Flows**
   - Trading Desk
   - Generische Wallet/Funding Rohtransfers
   - BotVault Profit-Claim/Recovery und FundingVault-backed Close
   - GridBot Langlauf/Restart/Cancel-Recovery

4. **Release-Kandidat erneut gegen Phase-1 pruefen**
   - Node/Build/Typecheck
   - Docker/Caddy/Port-Smoke
   - Migration/Backup/Restore
   - Secret-/Provider-Drift

## Phase-1 Runbook

1. Node 20 aktivieren:
   - `nvm use`
   - `node -v`
2. Dependencies frisch installieren:
   - `npm ci`
3. Code-Checks:
   - `npm -w apps/web run typecheck`
   - `npm -w apps/api run typecheck`
   - `npm run build`
   - `git diff --check`
4. Repo-Hygiene:
   - `git status --short`
   - `git ls-files -d '* 2.tsx' '* 2.ts'`
   - nach Commit: `git ls-files '* 2.tsx' '* 2.ts'`
5. Infra-Konfiguration:
   - `docker compose -f docker-compose.prod.yml config`
   - optional: `docker compose -f docker-compose.prod.yml build`
6. Staging/Backup/Migration:
   - Production-aehnliches DB-Backup erstellen.
   - `prisma migrate deploy` gegen Staging ausfuehren.
   - Restore-Probe dokumentieren.

## Aktueller Phase-1-Check

Stand: 2026-05-05

| Check | Ergebnis | Notiz |
| --- | --- | --- |
| VPS Host Node | `PASS` | `node -v` = `v20.20.2`, `npm -v` = `10.8.2`; NodeSource APT ist auf `node_20.x` gesetzt. |
| Container Node | `PASS` | API/Web/Runner melden jeweils Node `v20.20.1`. |
| Package-Manager-Guard | `PASS` | Blockiert `pnpm`/`yarn` User-Agent. |
| `npm ci --include=dev --workspaces --include-workspace-root --legacy-peer-deps` | `PASS` | 552 Pakete installiert, 0 Vulnerabilities. |
| `npm -w apps/web run typecheck` | `PASS` | Next route types generiert und TypeScript gruen. |
| `npm -w packages/exchange run build && npm -w packages/futures-exchange run build` | `PASS` | Stale lokale Dist-Typen fuer Binance-Exports aktualisiert. |
| `npm -w apps/api run typecheck` | `PASS` | API-Typecheck gruen nach Workspace-Dist-Rebuild. |
| `npm -w apps/api run test:auth` | `PASS` | 19 Tests PASS. |
| Production Docker Build | `PASS` | `docker compose --env-file .env.prod -f docker-compose.prod.yml build api web runner py-strategy-service` gruen. Laufende Container wurden nicht neu gestartet. |
| DB Backup/Restore/Migration | `PASS` | Backup `marketmaker-20260505T171045Z.dump`; Restore-Probe in Temp-DB erfolgreich; `prisma migrate deploy` ohne Pending Migrations. |
| `docker compose -f docker-compose.prod.yml config` | `PASS` | Mit `.env.prod` auf dem VPS gruen. |
| Caddy/Health/Port-Smoke | `PASS` | Caddy validate gruen; API lokal/public `/health` 200; Web public HEAD 307; API/Web nur auf `127.0.0.1`, Postgres/Redis nicht extern published. |
| `git diff --check` | `PASS` | Keine Whitespace-Fehler. |
| Duplicate-Dateien | `PASS` | `git ls-files '* 2.tsx' '* 2.ts' '* 2.jsx' '* 2.js'` ohne Treffer. |
| Production-Secret-Check | `DONE` | Betreiber-verifiziert am 2026-05-06. Final benoetigte Secrets sind gesetzt und Rotation ist dokumentiert/durchgefuehrt; keine Secret-Werte werden im Repo dokumentiert. |

## Quellen

- `docs/go-live-readiness-followups.md`
- `docs/admin-go-live-status.md`
- `docs/dashboard-calendar-news-go-live-status.md`
- `docs/ai-predictions-go-live-status.md`
- `docs/trading-desk-go-live-status.md`
- `docs/wallet-funding-go-live-status.md`
- `docs/botvault-go-live-followups.md`
- `docs/gridbot-go-live-status.md`
- `docs/normal-bots-go-live-status.md`
