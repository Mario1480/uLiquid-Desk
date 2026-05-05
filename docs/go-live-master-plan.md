# Go-live Master Plan

Stand: 2026-05-05

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
| Gate 1: Build & Infra | Repo, Build, Secrets, Migration und Docker/VPS sind releasefaehig. | `OPEN` | Production-Build, Typechecks, Migration-Smoke, Docker/Caddy-Smoke gruen. |
| Gate 2: Security/Auth/RBAC | Zugriffsschutz und Security-Flows sind in echter Umgebung geprueft. | `BLOCKED` | Phase-2-Smokes sind teilweise gruen; positiver Admin-/RBAC-Live-Flow ist durch Admin-Account/Credential-Status blockiert. |
| Gate 3: Read-only Produktflaechen | Dashboard, Calendar, News und AI Reads failen sichtbar/degraded statt falsch offen. | `BLOCKED` | Test-/Fail-closed-Pfade sind teilweise gruen; positive authentifizierte Live-Smokes haengen am Phase-2-Admin-/Testuser-Blocker. |
| Gate 4: Trading Canary | Manuelles Trading ist mit kleinen Limits live getestet. | `OPEN` | Paper-Smoke, Live-Canary, Idempotency- und Close-Sync-Smokes bestanden. |
| Gate 5: Wallet/Grid/BotVault Canary | Capital-Flows und Grid/Vault-Reconciliation laufen kontrolliert. | `OPEN` | Funding-, BotVault- und GridBot-Canary bestanden, Pending/Failed Alerts aktiv. |
| Gate 6: Beobachtung & Freigabe | Canary-Daten wurden 24-48h ausgewertet. | `OPEN` | Keine offenen P1/P2-Runtime-Bugs, Runbooks angepasst, Freigabeentscheidung dokumentiert. |

## Phase 1: Build, Repo und Infra

| Aufgabe | Quelle | Status | Verifikation / Command | Notizen |
| --- | --- | --- | --- | --- |
| Node `>=20.9.0` fuer Web-Build/Typecheck lokal, CI und Server fixieren. | Admin, Trading, AI | `DONE` | `node -v`; `npm -w apps/web run typecheck` | VPS-Host nutzt Node `v20.20.2`/npm `10.8.2`; API/Web/Runner-Container nutzen Node `v20.20.1`. NodeSource-APT-Kanal ist auf `node_20.x` gesetzt. |
| Full-Web-Typecheck ausfuehren. | Admin | `DONE` | `npm -w apps/web run typecheck` | PASS am 2026-05-05 nach `npm ci`; Next-Typegen aktualisierte `apps/web/next-env.d.ts` auf `.next/types/routes.d.ts`. |
| Production-Build frisch ausfuehren. | Readiness | `DONE` | `npm ci`; `npm run build` oder Docker-Build | PASS am 2026-05-05: `docker compose --env-file .env.prod -f docker-compose.prod.yml build api web runner py-strategy-service`. Images gebaut, laufende Container wurden dabei nicht neu gestartet. |
| API-Typecheck und relevante Tests erneut laufen lassen. | Admin/Readiness | `DONE` | `npm -w apps/api run typecheck`; gezielte Test-Suites | PASS nach frischem `npm ci` und Rebuild lokaler Workspace-Dist-Typen (`@mm/exchange`, `@mm/futures-exchange`). `npm -w apps/api run test:auth`: 19/19 PASS. |
| Duplicate-Dateien final bereinigen/stagen. | Admin | `DONE` | `git status --short`; nach Commit: `git ls-files '* 2.tsx' '* 2.ts'` | Keine getrackten `* 2.tsx`/`* 2.ts`/`* 2.js`/`* 2.jsx` Duplikate mehr. |
| Production-Secrets final setzen. | Readiness | `IN_PROGRESS` | `.env.prod`/Deployment-Secret-Check | Alle Keys aus `.env.prod.example` sind vorhanden und harte Basiswerte sind gesetzt. Noch leer/Owner-Entscheidung: `SMTP_PASS`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, `AGENT_SECRET_ENCRYPTION_KEY`, `HYPERLIQUID_AGENT_SECRETS_ENCRYPTED_JSON`; AI ist derzeit `AI_PROVIDER=disabled`. |
| Secret-Rotation planen und durchfuehren. | Readiness | `OPEN` | Rotationsprotokoll | Noch externe Owner-Arbeit: alte Admin-Fallbacks, Service-Tokens und Agent-/Telegram-/SMTP-Secrets bewusst rotieren oder dokumentiert akzeptieren. |
| Staging/Production-Migration mit Backup testen. | Readiness/AI | `DONE` | DB-Backup; `prisma migrate deploy` | PASS am 2026-05-05: Backup erstellt, Restore-Probe erfolgreich, `prisma migrate deploy` meldet 90 Migrations und keine Pending Migrations. Workspace-/Rollen-Smokes bleiben in Phase 2. |
| Docker/Caddy/VPS-Smoke. | Readiness/Trading | `DONE` | `docker compose -f docker-compose.prod.yml config`; `/health` | PASS am 2026-05-05: Compose config und Caddy validate gruen; API `/health` lokal und public `200`; Web HEAD public `307`; extern offen nur SSH/HTTP/HTTPS, API/Web nur auf `127.0.0.1`. |
| Backup-/Restore-Probe. | Readiness | `DONE` | Restore-Testprotokoll | PASS am 2026-05-05: `/var/backups/uliquid-desk/phase1/marketmaker-20260505T171045Z.dump` (87M), SHA256 `f51bdd6a5c88046e2597faf8bcac57579ca6f175417936ad5f08b315ca21ca6f`, Restore-Probe 87 Public Tables, Probe-DB wieder geloescht. |

## Phase 2: Security, Auth und RBAC

| Aufgabe | Quelle | Status | Verifikation | Notizen |
| --- | --- | --- | --- | --- |
| Auth-Smoke in echter Umgebung. | Readiness | `BLOCKED` | Live-Probes 2026-05-05: `/auth/login`, `/auth/register/resend`, `/auth/password-reset/request`; `npm -w apps/api run test:auth` | Resend und Password-Reset-Request fuer nicht existierende Smoke-Mail liefern `200 ok` ohne `devCode`; Auth-Tests 19/19 PASS. Produktiver Admin-Login mit aktuellem `.env.prod`-Credential liefert `401 invalid_credentials`; der konfigurierte Admin-User existiert mit Password-Hash, `emailVerifiedAt` ist leer und der gespeicherte Hash passt nicht zum aktuellen `ADMIN_PASSWORD`. Voller Register/Email-Verify/Login/Reset-Smoke braucht Owner-Test-Mailbox oder freigegebenen Admin-Account-Reset. |
| Rate-Limit-Smoke. | Readiness | `DONE` | Live-Probe 2026-05-05: 9 Login-Versuche auf neue Smoke-Mail | Request 9 liefert `429 { error: "rate_limited", retryAfterSec: 598 }`; API-Log enthaelt `api_rate_limit_blocked` fuer `auth_login_account`. |
| RBAC-Smoke mit Rollenmatrix. | Readiness/Dashboard/Admin | `BLOCKED` | `node node_modules/tsx/dist/cli.mjs --test apps/api/src/rbac.test.ts apps/api/src/auth/permissions.test.ts apps/api/src/auth/superadmin.test.ts apps/api/src/admin/routes-platform.test.ts` | Code-/Rollenmatrix 14/14 PASS; erweiterter Auth/Admin/Webhook-Testlauf 35/35 PASS. Live-Positive/Negative-RBAC ueber Admin/User/Viewer bleibt blockiert, bis ein funktionierender Admin-Login und Testnutzer verfuegbar sind. |
| Superadmin/Admin-Backend-Access pruefen. | Admin | `BLOCKED` | Live-Probe 2026-05-05: `/auth/me`, `/admin/users?limit=1`, `/grid/pilot-access`; Superadmin-Tests | `ADMIN_EMAIL` ist gesetzt und der Parser fuer kommaseparierte Admins ist getestet, produktiv ist aktuell ein Admin-Eintrag konfiguriert. Wegen fehlgeschlagenem Login liefern `/auth/me` und Admin/Grid-Routen erwartbar unauthenticated; positiver Admin-Backend-Access muss nach Account-Fix erneut laufen. |
| Webhook-Smoke inklusive SSRF-Schutz. | Readiness | `IN_PROGRESS` | `node node_modules/tsx/dist/cli.mjs --test packages/core/src/outboundSecurity.test.ts`; Notification-Plugin-Tests | Core-SSRF-Tests 3/3 PASS: HTTPS-Pflicht in Production, localhost und link-local/private IPs blockiert; Webhook-Plugin nutzt `validateSafeOutboundUrl`, `sanitizeOutboundHeaders` und `redirect: "error"`. Live-Smoke mit echter HTTPS-Webhook-URL bleibt offen, weil Admin-Zugriff/Test-Receiver fehlt. Header-Blocklist blockiert Hop-by-hop/Proxy/Sec/X-Forwarded-Header; `Authorization` wird aktuell bewusst durchgelassen, falls Webhook-Ziel Auth-Header braucht. |

Phase-2-Laufnotizen 2026-05-05:
- API `/health` ist public `200` und der Container ist aktuell `healthy`.
- Beim Phase-2-Smoke war ein API-Restart sichtbar (`restart_count=2`); API-Logs zeigten davor Prisma `P1001` gegen `postgres:5432`. Postgres ist aktuell wieder erreichbar, Ursache nicht abschliessend geklaert.
- SMTP ist ueber Environment nicht vollstaendig gesetzt (`SMTP_PASS` leer), es existiert aber ein DB-basierter `admin.smtp`-Eintrag mit verschluesseltem Passwort. Ein echter Email-Delivery-Smoke wurde noch nicht ohne Owner-Testadresse ausgefuehrt.

## Phase 3: Dashboard, Calendar, News und AI Reads

| Aufgabe | Quelle | Status | Verifikation | Notizen |
| --- | --- | --- | --- | --- |
| Dashboard Open Positions gesund/degraded testen. | Dashboard | `IN_PROGRESS` | `src/dashboard/routes.test.ts`; Live-401-Smoke | Unit-Smokes PASS: gesunde Venue-Reads liefern `meta.degraded=false`, partielle Fehler `meta.degraded=true`, komplette Fehler `503 dashboard_positions_degraded`. Authentifizierter Live-Smoke mit echten Venue-Credentials bleibt blockiert, bis Phase 2 Admin/Testuser geloest ist. |
| Dashboard RBAC-Smoke. | Dashboard | `BLOCKED` | Live-Probe 2026-05-05: `/dashboard/open-positions`, `/dashboard/overview`, `/economic-calendar`, `/news`, `/api/predictions` ohne Cookie | Alle getesteten Read-only-Routen liefern ohne Session `401 unauthorized`. Positiv-/Negativtest mit Rollenrechten braucht funktionierenden Admin-Login und Testrollen. |
| Calendar-Smoke mit echtem FMP-Key. | Dashboard | `IN_PROGRESS` | `src/routes/economic-calendar.test.ts`; DB-/Config-Smoke | Calendar-Tests PASS: Date-Range-Validierung, 31-Tage-Grenze, `limit` und `truncated`. Production hat einen gespeicherten FMP-Key in `admin.apiKeys`, `economic_events` enthaelt 3123 Events bis 2026-05-08, Config ist enabled. Authentifizierter `/economic-calendar`-/`/economic-calendar/next`-Live-Smoke und Admin-FMP-Healthcheck bleiben blockiert. |
| News-Risk Blocking-Smoke. | Dashboard | `IN_PROGRESS` | `src/services/economicCalendar/index.test.ts`; `src/predictions/routes-generate.test.ts` | Degraded-Pfad bei fehlendem FMP-Key ist getestet und liefert `newsRiskDegraded`; Prediction-Generate-Smokes PASS. Production-Config hat `enforceNewsRiskBlock=false`; den produktiven FMP-Key temporaer zu entfernen oder Enforcement live umzuschalten ist Owner-/Admin-Arbeit und wurde nicht gemacht. |
| AI Provider-Konfig-Smoke. | AI | `IN_PROGRESS` | `src/ai/provider.config.test.ts`; DB-/Proxy-Smoke | AI-Provider-Sicherheitschecks PASS: unsichere OpenAI-compatible URLs werden blockiert und `unsafe_ai_base_url` geloggt; private Ollama/vLLM-URLs sind nur mit expliziter Freigabe erlaubt. Test wurde hermetisch gegen VPS-Env-Flags gemacht. Production-DB setzt `aiProvider=ollama`, Base-URL `http://salad-proxy:8088/v1`, Modell `qwen3:30b`; `salad-proxy` Container ist healthy, `/v1/models` liefert aber 404. Echter Chat-Healthcheck bleibt Admin-/Owner-abhaengig. |
| AI Refresh-Degraded-Smoke in API und UI. | AI | `IN_PROGRESS` | `src/predictions/refreshHealth.test.ts`; `src/predictions/refreshService.test.ts`; `apps/web/src/predictions/refreshUi.test.ts`; API-Logs | Refresh-Degraded-Patches, Failure-Sanitizing, Feed-/Schedule-UI-Metadaten und Copy-Summary sind getestet. Production-Logs zeigen wiederholte `ai_quality_gate_blocked_refresh`/`ai_quality_gate_decision`; authentifizierter UI-Smoke bleibt blockiert. |
| AI Evaluator-Stichprobe gegen Candle-Daten. | AI | `IN_PROGRESS` | `src/jobs/predictionEvaluatorJob.test.ts`; `src/predictions/evaluationFramework.test.ts` | Evaluator-/Framework-Tests PASS, inklusive Directional Return, Horizon und Summary. Production enthaelt 1796 `Prediction`-Rows und 4 `predictions_state`-Rows; manuelle Stichprobe mit authentifiziertem User/API bleibt offen. |
| Monitoring fuer Read-only Flaechen aktivieren. | Dashboard/AI | `IN_PROGRESS` | `src/admin/externalHealth.test.ts`; `src/jobs/systemHealthTelegramJob.test.ts`; API-Logs | External-Health- und System-Health-Telegram-Tests PASS. Logs enthalten AI-Quality-Gate-Telemetrie; keine aktuellen `calendar_read_failed`/`unsafe_ai_base_url`-Fehler im geprueften Fenster. Telegram-Delivery bleibt wegen leerem `TELEGRAM_BOT_TOKEN`/`TELEGRAM_CHAT_ID` aus Phase 1 nicht produktiv aktiv. |

Phase-3-Laufnotizen 2026-05-05:
- API-Read-only-Routen sind public nicht offen: getestete Dashboard-, Calendar-, News- und Prediction-Routen liefern ohne Cookie `401 unauthorized`.
- Phase-3-Testlauf PASS: 97/97 API-Tests fuer Dashboard, Calendar, News, AI-Provider, AI-Refresh, News-Risk und Evaluator; Web-Refresh-UI 4/4 PASS; External/System-Health 8/8 PASS.
- Fix umgesetzt: `apps/api/src/ai/provider.config.test.ts` neutralisiert AI-private-Base-URL-Env-Flags temporaer, damit Security-Tests auf dem VPS deterministisch bleiben.

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
| Wallet Funding Deposit Canary. | Wallet/Funding | `OPEN` | Arbitrum USDC -> Intent -> pending -> Hyperliquid credited target -> confirmed | Balance-basiert reconciled. |
| Wallet Funding Withdraw Canary. | Wallet/Funding | `OPEN` | Hyperliquid withdrawable -> pending -> Arbitrum Zielbalance -> confirmed | Source-Balance allein reicht nicht. |
| Core/EVM und Spot/Perp Transfer Canary. | Wallet/Funding | `OPEN` | Zielbalance-Anstieg um angefragten Betrag | Pending blockiert gleichen Flow bis Abschluss. |
| Pending-Intent Cleanup/Expiry entscheiden. | Wallet/Funding | `OPEN` | Manuell akzeptiert oder Job/Runbook vorhanden | Aktuell konservativ manuell. |
| BotVault Funding/Reconcile Canary. | BotVault | `OPEN` | Pending Deposit/Withdraw, HYPE Reserve, Contract Balance, Claim/Close | Reason/recovery sichtbar machen. |
| Bestehende Vaults normalisieren/pruefen. | BotVault | `OPEN` | Reconcile-Job oder Migration fuer alte Mischzustaende | Alte v3 Reads kompatibel halten, neue Writes v4-normalisiert. |
| GridBot Funding/Seed/Recovery Canary. | GridBot | `OPEN` | Funding, Seed-Pending, Restart-Recovery, Cancel-Reconcile, Fill/PnL-Reconcile | Langlauf ueber mehrere Marktzyklen einplanen. |
| Canary-Limits technisch setzen. | GridBot/BotVault | `OPEN` | Max Vault-Groesse, parallele Bots, Pending-Dauer | Kleine Limits fuer ersten Live-Betrieb. |
| Monitoring fuer Pending/Failed/Reconcile aktivieren. | Wallet/Grid/BotVault | `OPEN` | Deposit/Withdraw/Funding pending, failed retry/final, Reconcile-Job | Alert-Schwellen nach Canary feinjustieren. |
| Admin-Operational-View pruefen/erweitern. | BotVault/Grid/Admin | `OPEN` | `reasonCode`, `recoveryHint`, `txHash`, `idempotencyKey`, Account-State-Zeitpunkt | Fuer Support und manuelle Recovery. |

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

1. **Node/Build/Typecheck sauber machen**
   - Node `>=20.9.0`
   - `npm -w apps/web run typecheck`
   - Production-Build
   - API-Typecheck

2. **Repo-Hygiene finalisieren**
   - Duplicate-Dateien entfernen/stagen
   - weitere `* 2.tsx` / `* 2.ts` bewerten

3. **Staging-Migration und Infra-Smoke**
   - Backup
   - `prisma migrate deploy`
   - Docker/Caddy/Port-Smoke

4. **Security-Smokes**
   - Auth
   - RBAC
   - Webhooks

5. **Read-only Produkt-Smokes**
   - Dashboard
   - Calendar/News
   - AI Provider/Refresh

6. **Riskante Canary-Flows**
   - Trading Desk
   - Wallet/Funding
   - BotVault
   - GridBot

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
| Production-Secret-Check | `IN_PROGRESS` | Keine fehlenden Template-Keys; harte Basiswerte gesetzt. Feature-/Owner-Entscheidungen offen: SMTP, Telegram, Agent-Secrets; AI aktuell disabled. |

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
