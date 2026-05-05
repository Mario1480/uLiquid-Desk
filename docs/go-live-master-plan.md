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
| Gate 2: Security/Auth/RBAC | Zugriffsschutz und Security-Flows sind in echter Umgebung geprueft. | `OPEN` | Auth-, RBAC- und Webhook-Smokes bestanden. |
| Gate 3: Read-only Produktflaechen | Dashboard, Calendar, News und AI Reads failen sichtbar/degraded statt falsch offen. | `OPEN` | Degraded-/Provider-/Calendar-Smokes und Monitoring aktiv. |
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
| Auth-Smoke in echter Umgebung. | Readiness | `OPEN` | Register, Email-Verify, Login, Password Reset | Auch Resend/OTP-Lockout pruefen. |
| Rate-Limit-Smoke. | Readiness | `OPEN` | Erwartet `429 { error: "rate_limited", retryAfterSec }` | Auth-429 danach monitoren. |
| RBAC-Smoke mit Rollenmatrix. | Readiness/Dashboard/Admin | `OPEN` | Admin/User/Viewer/Trading-Permissions | Ownership-Checks zusaetzlich pruefen. |
| Superadmin/Admin-Backend-Access pruefen. | Admin | `OPEN` | `/auth/me`, Admin-Routen, Grid Admin Access | Mehrere `ADMIN_EMAIL`-Eintraege testen. |
| Webhook-Smoke inklusive SSRF-Schutz. | Readiness | `OPEN` | HTTPS erlaubt; localhost/private/link-local/redirect blockiert | Verbotene Custom Headers duerfen nicht weitergereicht werden. |

## Phase 3: Dashboard, Calendar, News und AI Reads

| Aufgabe | Quelle | Status | Verifikation | Notizen |
| --- | --- | --- | --- | --- |
| Dashboard Open Positions gesund/degraded testen. | Dashboard | `OPEN` | Gesunde Venue-Credentials und blockierte/degraded Credentials | UI darf nicht falsch "keine offenen Positionen" anzeigen. |
| Dashboard RBAC-Smoke. | Dashboard | `OPEN` | Nutzer ohne Permission darf Dashboard-Daten nicht lesen | Nutzer mit passender Permission darf lesen. |
| Calendar-Smoke mit echtem FMP-Key. | Dashboard | `OPEN` | 31-Tage-Grenze, `limit`, `truncated`, `/economic-calendar/next` | Monitoring fuer `calendar_read_failed`. |
| News-Risk Blocking-Smoke. | Dashboard | `OPEN` | `enforceNewsRiskBlock=true`, FMP-Key entfernen | Auto-/tradable Predictions muessen blockieren. |
| AI Provider-Konfig-Smoke. | AI | `OPEN` | Sichere HTTPS-Base-URL, getrennte Staging/Production-Secrets | `unsafe_ai_base_url` monitoren. |
| AI Refresh-Degraded-Smoke in API und UI. | AI | `OPEN` | Feed/Schedules zeigen degraded sichtbar | Degraded Predictions duerfen nicht in Trading Desk gesendet werden. |
| AI Evaluator-Stichprobe gegen Candle-Daten. | AI | `OPEN` | v2 realized returns plausibilisieren | Keine Auto-Trading-Entscheidung auf fehlender History. |
| Monitoring fuer Read-only Flaechen aktivieren. | Dashboard/AI | `OPEN` | Alerts fuer degraded Refresh, Calendar, News, Provider, Evaluator-Lag | Schwellen vor Canary definieren. |

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
