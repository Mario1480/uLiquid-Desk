# Projektweite Go-live Feature-Analyse

Stand: 2026-05-06

Scope: statischer Abgleich der aktuellen lokalen Working Tree gegen die vorhandenen Go-live-/Readiness-Dokumente. Es wurden keine externen Live-Systeme oder Production-Secrets abgefragt. Die lokal bereits vorhandenen, noch nicht committeten BotVault-Hardening-Aenderungen sind in dieser Analyse als aktueller Code-Stand mit betrachtet.

Nachtrag 2026-05-06: Betreiber-verifiziert und in den Feature-Go-live-Dokumenten nachgetragen wurden Production-Secrets, Secret-Rotation, Superadmin/Admin-Backend-Access, Dashboard Open Positions gesund/degraded, Calendar-Smoke mit echtem FMP-Key, News-Risk Blocking-Smoke, AI Provider-Konfig-Smoke, AI Refresh-Degraded-Smoke in API und UI, AI Evaluator-Stichprobe gegen Candle-Daten sowie Monitoring fuer Read-only Flaechen.

## Executive Summary

Das Projekt ist kein einzelner "Go-live-Schalter", sondern eine Plattform mit mehreren getrennten Risikoprofilen: Auth/RBAC/Admin, Dashboard/News/Calendar, AI Predictions, Manual Trading, Exchange Accounts, Wallet/Funding, GridBot, BotVault/Profitshare, Normal Bots, Billing, Monitoring und Contracts.

Code-seitig sind viele der frueheren Go-live-Findings bereits sichtbar bearbeitet: Admin-Hardening, zentralisierte Security-/RBAC-Pfade, AI/Dashboard-Fail-Closed-Verhalten, Trading-Desk-Schutzlogik, Wallet-Funding-Reconciliation und BotVault/Grid-Funding-Hardening sind im Code und in den Feature-Dokumenten erkennbar. Fuer einen kontrollierten internen Canary ist die Basis deutlich besser als in den aelteren Analysepunkten.

Fuer einen breiten Public Go-live bleiben aber mehrere harte Gates offen:

- Live/Auth- und RBAC-Smoke: Superadmin/Admin-Backend-Access ist erledigt; volle Register/Login/Reset- und Rollenmatrix-Smokes fuer Admin/User/Viewer bleiben nachzuhalten.
- Secrets/Infra: Production-Secrets und Rotation sind Betreiber-verifiziert; Migration, Backup/Restore und Docker/Caddy sind in Phase 1 dokumentiert. Bei Secret-/Provider-Wechseln muessen die Smokes wiederholt werden.
- Kapital-Flows: Manual Trading, Wallet/Funding, GridBot und BotVault brauchen kleine, protokollierte Canary-Laeufe mit echten oder production-nahen Venues.
- Monitoring/Runbooks: Read-only Monitoring ist aktiviert; kapitalbewegende Alerts, Eskalation und Operator-Runbooks muessen live bewiesen werden.
- Contract Readiness: BotVault-Contract-Deployment, Ownership/Timelock/Dual-Control, Event-Indexing und externe Audit-/Fuzz-Follow-ups sind noch nicht als erledigte Release-Evidenz dokumentiert.
- Dokumentationsdrift: Einige Feature-Go-live-Dokumente sind aelter als der aktuelle lokale Code-Stand. Vor Release sollte eine zentrale Evidence-Tabelle mit Commit, Datum, Check und Ergebnis gepflegt werden.

Fazit: Ein interner Read-only Canary ist nach den am 2026-05-06 erledigten Betreiber-Smokes deutlich naeher. Ein Public Go-live fuer kapitalbewegende Features sollte erst nach RBAC-Rollenmatrix, BotVault/Grid/Trading/Wallet-Canaries, Contract-Readiness und Operational-Runbooks freigegeben werden.

## Feature Map

| Bereich | Code-Oberflaechen | Go-live-Dokumente | Code-Reife | Go-live-Reife | Hauptluecke |
| --- | --- | --- | --- | --- | --- |
| Infra/Build/Deploy | Root scripts, Docker Compose, Dockerfiles, Prisma, workspace packages | `go-live-master-plan.md`, `go-live-readiness-followups.md`, `consolidation-release-checklist.md` | Hoch | Hoch | Phase-1-Evidence und Secrets/Rotation sind dokumentiert; bei Release-Commit erneut ausfuehren |
| Auth/RBAC/Security | `apps/api/src/auth.ts`, `index.ts`, RBAC/Admin guards, sessions, OTP, audit | `go-live-readiness-followups.md`, `admin-go-live-status.md` | Hoch | Mittel | Superadmin/Admin-Backend ist erledigt; volle Auth-/RBAC-Rollenmatrix bleibt offen |
| Admin Platform | Admin routes, platform admin, users/workspaces/licenses/bots/runners, alerts, vault ops | `admin-go-live-status.md`, `go-live-master-plan.md` | Hoch | Mittel-Hoch | Admin-Doku aktualisiert und Backend-Access erledigt; Staging-Smoke mit realistischen Daten bleibt |
| Billing/Subscription | `apps/api/src/billing`, Admin Billing UI, token ledger, packages/orders/webhooks | Admin-Doku teilweise, kein eigenes Billing-Go-live-Dokument | Mittel | Niedrig-Mittel | Checkout/Payment/Webhook-Production-Smoke und eigenes Billing-Runbook fehlen |
| Dashboard/Calendar/News | Dashboard routes, market/news/calendar routes, FMP/news integrations | `dashboard-calendar-news-go-live-status.md` | Hoch | Hoch fuer Read-only | Provider/Open-Positions/News/Monitoring-Smokes erledigt; RBAC-Rollenmatrix bleibt offen |
| AI Predictions | Prediction routes/jobs, provider proxy, evaluator, refresh jobs, AI trace/admin prompts | `ai-predictions-go-live-status.md` | Hoch | Mittel-Hoch fuer Read-only | Provider/Refresh/Evaluator/Monitoring erledigt; AI-only und Auto-Trading-Uebergabe separat pruefen |
| Manual Trading Desk | Manual market/execution routes, exchange adapters, order idempotency | `trading-desk-go-live-status.md` | Hoch | Mittel | Paper/live canary, idempotency/degraded smokes, operator runbook |
| Exchange Accounts/CEX | Exchange account routes, Bitget/Hyperliquid/MEXC/Binance/Paper adapters | `exchange-capability-matrix.md`, `venue-parity-gap-analysis.md`, CEX preflight docs | Mittel-Hoch | Mittel | Venue parity, connector-specific live smokes, Paper as first-class adapter |
| Wallet/Funding | Funding intents, wallet overview, spot/EVM/Core transfers, reconciliation | `wallet-funding-go-live-status.md`, BotVault docs | Hoch | Mittel | Real transfer canary, pending/recovery ops, alert delivery |
| GridBot | Grid API, runner grid runtime, templates, instances, recovery, fills/PnL | `gridbot-go-live-status.md`, BotVault docs | Hoch | Mittel | Canary monitoring, long-run observation, admin drilldowns |
| BotVault/Profitshare | Vault routes/services/jobs, onchain actions, pnl, settlement, reconciliation | `botvault-go-live-followups.md`, `botvault-e2e-integration-test-matrix.md`, contract checklist | Hoch but active changes | Niedrig-Mittel | Capital canary, contract readiness, settlement proof, alert/runbook proof |
| Normal Bots/Strategies | Bot catalog, bot lifecycle, local/composite strategies, runner modes | `normal-bots-go-live-status.md` | Mittel | Niedrig-Mittel | Real signal adapter, fill history, paper/live adapter parity |
| Notifications/Monitoring | Telegram, SMTP, PlatformAlert, health jobs, admin alert UI | Readiness/admin/BotVault docs | Mittel-Hoch | Mittel-Hoch fuer Read-only | Read-only Monitoring aktiv; kapitalbewegende Alert-Delivery und Eskalation bleiben |
| Contracts | `packages/contracts`, deployment/check scripts, BotVaultV4 ABI usage | `contract-readiness-checklist.md` | Mittel | Niedrig-Mittel | Deployment evidence, external audit, invariant/fuzz, ownership controls |
| Backtests/Quant/Python service | py strategy service, runner backtest, strategy definitions | scattered docs | Mittel | Niedrig | Separate go-live story missing; mostly supporting feature today |
| Affiliate/Profitshare | affiliate admin/routes/settings, ProfitShareAccrual, fee events | master/admin/BotVault docs | Mittel | Niedrig-Mittel | Settlement/profitshare canary and billing alignment |

## Abgleich der Go-live-Dokumente

| Dokument | Aussage im Dokument | Abgleich mit aktuellem Code-Stand | Bewertung |
| --- | --- | --- | --- |
| `docs/go-live-master-plan.md` | Phasenplan ueber Build/Infra, Security, Feature-Smokes und Release | Passt als fuehrende Struktur. Einige Feature-Subdocs brauchen Rueckverlinkung auf aktuelle Evidence. | Beibehalten und als Release-Index nutzen |
| `docs/go-live-readiness-followups.md` | Security/Env/Auth/RBAC/Webhook/Docker-Hardening erledigt, ops offen | Secrets und Rotation sind am 2026-05-06 Betreiber-verifiziert; volle Auth-/RBAC-/Webhook-Smokes bleiben nachzuhalten. | Weiterhin zentrale P0/P1-Liste |
| `docs/admin-go-live-status.md` | Admin-Findings gefixt, Web-Typecheck und Admin-Backend-Access erledigt | Am 2026-05-06 aktualisiert. Staging-Smoke mit realistischen Daten bleibt offen. | Gueltig |
| `docs/trading-desk-go-live-status.md` | Trading Desk code-ready, Live/Paper-Smokes offen | Deckt Code-Schutzlogik gut ab. Canary/Runbook/Monitoring sind noch Go-live-Gates. | Weiterhin gueltig |
| `docs/dashboard-calendar-news-go-live-status.md` | Dashboard/News/Calendar fail-closed und RBAC-hart | Open-Positions-, FMP-, News-Risk- und Read-only-Monitoring-Smokes sind am 2026-05-06 erledigt; Rollenmatrix bleibt separat. | Gueltig |
| `docs/ai-predictions-go-live-status.md` | AI hardening erledigt, Provider/Evaluator/Refresh-Smokes offen | Provider-, Refresh-Degraded-, Evaluator- und Monitoring-Smokes sind am 2026-05-06 erledigt; AI-only/Auto-Trading-Uebergabe bleibt separat. | Gueltig |
| `docs/wallet-funding-go-live-status.md` | Funding/Reconciliation verbessert, Canary offen | Passt zum aktuellen Projektbild. BotVault-Hardening erweitert denselben Risikobereich. | Gueltig, mit BotVault-Doku verbinden |
| `docs/gridbot-go-live-status.md` | GridBot weitgehend code-ready, Canary/Monitoring offen | Passt. Aktueller Code fuehrt zusaetzliche Funding-Pending-Hardening-Pfade ein. | Aktualisieren nach BotVault-Fixes |
| `docs/normal-bots-go-live-status.md` | Normal Bots bewusst begrenzt, reale Signal-/Fill-Parity offen | Passt. Normal Bots sollten nicht vor BotVault/Grid/Trading als kapitalstarkes Feature priorisiert werden. | Gueltig |
| `docs/botvault-go-live-followups.md` | BotVault Canary/Public Go-live Punkte | Aktuell wichtigstes Kapital-Risikodokument. Muss nach lokalen BotVault-Hardening-Aenderungen final abgeglichen werden. | P0 fuer Kapital-Go-live |
| `docs/botvault-e2e-integration-test-matrix.md` | End-to-end Matrix fuer Funding/Grid/Profitshare/Recovery | Sehr relevant, sollte als Canary-Protokoll genutzt werden. | Als Test-Evidence ausbauen |
| `docs/contract-readiness-checklist.md` | Contract deployment, audit, ownership, monitoring | Noch nicht als erledigt belegt. Blockiert breiten Public BotVault-Go-live. | P0/P1 je nach Canary-Umfang |
| `docs/exchange-capability-matrix.md` | Venue-/Adapter-Capabilities | Hilfreich, aber eher Matrix als Release-Status. | Mit CEX-Go-live zusammenfuehren |
| `docs/venue-parity-gap-analysis.md` | Bitget/Hyperliquid/MEXC/Paper Gaps | Aelter, aber die Grundaussage bleibt relevant: nicht alle Venues sind gleich go-live-faehig. | Aktualisieren |
| CEX Preflight-/Playbook-Dokumente | Exchange-spezifische Betriebschecks | Gut als Ops-Material, aber nicht prominent im Master-Status. | In zentrale Matrix aufnehmen |

## Feature-Analyse im Detail

### 1. Infra, Build und Deployment

Vorhanden:

- Monorepo mit `apps/api`, `apps/web`, `apps/runner`, `apps/py-strategy-service` und mehreren Packages.
- Root-Scripts fuer Build, Typecheck, Regression, Docker und Prisma.
- Production Docker Compose und Service-Dockerfiles.
- Phase-1-Dokumentation fuer Node 20, Build Checks, Docker Config, Migration, Backup/Restore.

Abgleich:

- Die Code-/Repo-Struktur ist grundsaetzlich releasefaehig aufgebaut.
- Die Go-live-Dokumente behandeln die wichtigsten Infrastrukturthemen.
- Die groesste Luecke ist nicht Code, sondern Release-Evidence auf dem finalen Commit: die Phase-1-Checks sind dokumentiert, sollten aber bei jedem Release-Kandidaten erneut protokolliert werden.

Bei finalem Release-Kandidaten erneut ausfuehren:

- Finaler Check mit Node `>=20.9.0 <21` oder bewusst dokumentiertem Runtime-Ziel.
- `docker compose -f docker-compose.prod.yml config` und Build fuer alle relevanten Services.
- Staging-Migration mit `prisma migrate deploy`.
- Backup und Restore-Probe.
- Secret-/Provider-Drift pruefen, ohne Secret-Werte im Repo zu dokumentieren.

### 2. Auth, RBAC und Security

Vorhanden:

- Zentrale Auth-/RBAC-Pfade, Workspace-Rollen, Admin Guards, Audit-Events.
- Hartere Env-/Admin-Seeding- und Superadmin-Logik wurde in den Admin/Readiness-Fixes behandelt.
- OTP/Reauth, Session-Modelle, SIWE und Webhook-Hardening sind im Code sichtbar.

Abgleich:

- Die Security-Go-live-Doku ist weitgehend code-nah.
- Superadmin/Admin-Backend-Access ist am 2026-05-06 erledigt. Der kritischste offene Punkt ist jetzt die volle Auth- und RBAC-Rollenmatrix mit Admin/User/Viewer inklusive negativer Rechtepruefung.

Offen vor breiter User-Freigabe:

- Register/Email-Verify/Login/Reset Smoke.
- RBAC Negative-Smoke: User darf keine Admin-/fremden Workspace-Daten sehen.
- Webhook SSRF/Allowlist Smoke.
- Audit-Log Smoke fuer sicherheitsrelevante Admin-Aktionen.

### 3. Admin Platform

Vorhanden:

- Umfangreiche Admin-UI: Users, Workspaces, Licenses, Bots, Runners, System, Billing, Vault Ops, Vault Safety, Alerts, Prediction Defaults, Strategies, SMTP, Telegram.
- Admin API-Routes fuer Platform, Billing, Vault Ops, API Keys, Prediction Settings, Affiliate und Operations.
- Fruehere Findings zu Billing Token Adjust, Superadmin-Erkennung, Pagination und Duplicate-Dateien wurden im Admin-Status als behoben dokumentiert.

Abgleich:

- Admin ist code-seitig einer der staerkeren Bereiche.
- Das Admin-Dokument ist teilweise veraltet, weil dort ein Web-Typecheck mit Node 18 als offen markiert war, waehrend spaetere Phase-1-Verifikation mit neuerem Node-Setup bestanden hat.

Offen vor Go-live:

- Admin-Go-live-Status aktualisieren.
- Staging-Smoke mit realistisch grossen Listen fuer Users/Workspaces/Licenses/Bots/Runners.
- Vault Ops und PlatformAlerts mit echten Pending-/Recovery-Szenarien testen.

### 4. Billing und Subscription

Vorhanden:

- Billing API mit Packages, Orders, Checkout, Subscription, Token Ledger und Webhook-Events.
- Admin Billing UI und User Subscription Settings.
- AI Token Ledger ist mit Subscription/Billing verbunden.

Abgleich:

- Billing ist technisch vorhanden, aber nicht als eigenstaendiges Go-live-Feature dokumentiert.
- Das fruehere Admin-Billing-Finding betrifft nur Token Adjust, nicht den gesamten Payment-/Checkout-Lifecycle.

Offen vor Go-live:

- Eigenes `billing-go-live-status.md` oder Abschnitt im Master-Plan.
- Payment Provider Smoke: Checkout, Webhook Signature, Idempotency, failed payment, renewal/cancel.
- Token-/Capacity-Grant Smoke fuer AI und Workspace-Limits.
- Admin Refund/Correction/Manual Adjustment Runbook.

### 5. Dashboard, Calendar und News

Vorhanden:

- Dashboard API und UI.
- Economic Calendar Config/Event, Jobs und User Preferences.
- News Risk, URL Sanitizing, fail-closed Verhalten.

Abgleich:

- Dokument und Code passen gut zusammen.
- Die Feature-Reife ist fuer read-mostly Funktionen hoch, aber externe Provider muessen live getestet werden.

Offen vor Go-live:

- Dashboard RBAC Smoke ueber Workspaces/Rollen.
- Laufende Beobachtung fuer Provider-Ausfall, degraded/partial data und News-Provider-Partial-Failures.
- RBAC Smoke ueber Workspaces.

### 6. AI Predictions

Vorhanden:

- Prediction Generate/Read/Lifecycle/State Routes.
- Evaluator- und Refresh-Jobs.
- Provider Proxy mit Outbound-Hardening.
- AI Trace/Admin Prompts.

Abgleich:

- Code und Doku zeigen gute Fail-Closed- und Refresh-Hardening-Arbeit.
- Go-live haengt stark an Provider-Secrets, Quoten, Rate Limits und Monitoring.

Offen vor Go-live:

- Provider-Konfig ist am 2026-05-06 fuer die aktuelle Betreiber-Konfiguration erledigt; bei Wechsel wiederholen.
- AI-only fail-closed Smoke.
- Prediction Refresh und Evaluator mit echten/production-nahen Daten sind am 2026-05-06 stichprobenartig erledigt; fuer Release-Commit erneut protokollieren.
- Kosten-/Rate-Limit-Monitoring.
- Billing-Token-Verbrauch mit AI-Flows pruefen.

### 7. Manual Trading Desk

Vorhanden:

- Market data, account summary, positions, open orders.
- Order create/edit/cancel/cancel-all, TPSL, close, leverage.
- Idempotency und degraded/live-read-Schutz wurden in der Trading-Doku behandelt.

Abgleich:

- Code-Hardening wirkt stark, aber Trading bleibt ein kapitalbewegendes Feature.
- Go-live-Doku nennt zurecht Paper- und Live-Canary als offene Gates.

Offen vor Go-live:

- Paper Trading Smoke mit Order Lifecycle.
- Kleine Live-Canary pro freigegebener Venue.
- Idempotency-Smoke bei Retry/Timeout.
- Degraded market/account data Smoke.
- Operator-Runbook fuer Cancel-All, Close und API-Ausfall.

### 8. Exchange Accounts, CEX und Venue Parity

Vorhanden:

- Exchange Account CRUD und Connection-Test.
- Adapter fuer Bitget, Hyperliquid, MEXC, Paper und Binance-Oberflaechen.
- Capability Matrix und Venue Gap Analyse.
- Spot/Funding-Support insbesondere fuer Bitget und Hyperliquid.

Abgleich:

- Das Projekt behandelt Venues bewusst differenziert; das ist richtig.
- Die Dokumente zeigen aber nicht ueberall finalen Release-Status pro Venue.

Offen vor Go-live:

- Pro Venue eine Freigabematrix: read-only, paper, manual trading, grid, botvault, withdrawals.
- MEXC-/Paper-Gaps aktualisieren.
- Connector-Live-Smokes mit kleinsten Limits.
- UI muss Venue-Capability-Grenzen klar respektieren.

### 9. Wallet und Funding

Vorhanden:

- Funding Intents, Wallet Overview, Activity, External Links.
- EVM/Core/Spot/Perp Transferpfade.
- Reconciliation und Pending-/Recovery-Metadaten.

Abgleich:

- Wallet-Funding-Doku passt zum aktuellen Risikoprofil.
- Die juengeren BotVault-Hardening-Punkte ergaenzen dieselbe Flaeche, insbesondere Zielbalance und Pending-Reconciliation.

Offen vor Go-live:

- Deposit/Withdraw/Core-EVM/Spot-Perp Canary.
- Pending Timeout und Recovery Runbook.
- PlatformAlert-Zustellung fuer Money-Flows.
- Admin Vault-Ops Sicht auf Pending-Art, Alter, Reason Code und Recovery Hint.

### 10. GridBot

Vorhanden:

- Grid Templates, Favorites, Instance Lifecycle, Risk Preview, Margin, Claim/Withdraw Profit.
- Runner Grid Runtime, Recovery, Order Maps, Fill Events.
- Funding-Pending-Hardening ist im aktuellen lokalen Code in Arbeit/enthalten.

Abgleich:

- GridBot ist fuer kontrollierten Canary nah dran, aber nicht "blind public ready".
- Grid- und BotVault-Risiken ueberlappen bei Funding, Reconciliation und Settlement.

Offen vor Go-live:

- Funding Pending State in API/UI/Runner final verifizieren.
- Grid Start ohne Funding blocken.
- Canary mit kleinen Limits und langer Beobachtung.
- Admin Drilldowns fuer stuck funding/recovery.

### 11. BotVault und Profitshare

Vorhanden:

- BotVault APIs, services, funding, controller close/recover, ledger, PnL aggregate, profitshare, onchain action tracking.
- Jobs fuer Accounting, Onchain Indexing/Reconciliation und Trading Reconciliation.
- BotVault E2E Matrix und Follow-up-Doku.
- Aktuelle lokale Hardening-Aenderungen betreffen Deposit-Semantik, `funding_pending`, Safety Controls, Reconciliation Freshness, Alerts und Admin Ops.

Abgleich:

- BotVault ist der komplexeste und riskanteste Bereich, weil Offchain/Onchain/Runner/Venue/UI/Admin zusammenlaufen.
- Code-Hardening ist sichtbar, aber Public Go-live braucht zwingend E2E-Evidenz.

Offen vor Go-live:

- E2E Canary: Fund -> HyperCore Deposit -> Grid Start -> Orders -> Claim/Close/Recover -> Profitshare.
- Reconciliation Freshness vor Claim/Close/Recover beweisen.
- Keine doppelte Settlement-Auszahlung bei Retry/Timeout.
- PlatformAlert Matrix live testen.
- Contract Readiness abschliessen.
- Emergency/Safety Controls live pruefen.

### 12. Normal Bots und Strategies

Vorhanden:

- Bot Catalog, Bot Lifecycle, runtime states, risk events.
- Local and composite strategies, AI prompt/admin strategy tooling.
- Runner-Modi fuer legacy/simple/backtest/prediction-related execution.

Abgleich:

- Normal-Bots-Doku sagt korrekt: bewusst eingeschraenkte Go-live-Faehigkeit.
- Normal Bots sollten nicht vor den Kern-Trading-/Venue-/Reconciliation-Flows breit live gehen.

Offen vor Go-live:

- Realer Signal Adapter oder klarer Product-Scope.
- Venue Fill History und Recovery.
- Paper Adapter als erster stabiler Modus.
- User UI fuer Pending/Recovery/Degraded states.

### 13. Notifications, Monitoring und Ops

Vorhanden:

- PlatformAlert Modell und Admin UI.
- PlatformAlert Cleanup Job.
- Telegram, SMTP und System Health Jobs.
- BotVault Money-Flow Alerts werden in der aktuellen Hardening-Arbeit ausgebaut.

Abgleich:

- Code-Grundlage ist gut.
- Operativ zaehlt aber die Zustellung: Alerts muessen wirklich bei Operatoren ankommen und geschlossen/eskaliert werden.

Offen vor Go-live:

- SMTP Smoke.
- Telegram Smoke.
- PlatformAlert create/update/resolve Smoke.
- Eskalationsmatrix: wer reagiert wann auf welche Alert-Klasse.
- Runbooks fuer Funding stuck, Venue down, stale reconciliation, low HYPE, settlement retry, close-only.

### 14. Contracts

Vorhanden:

- Contracts Package und BotVaultV4-nahe Doku.
- Contract Readiness Checklist mit Deployment-/Audit-/Monitoringpunkten.

Abgleich:

- Contract-Doku ist richtig vorsichtig.
- Der aktuelle Go-live-Status zeigt nicht, dass externe Audit-, fuzz/invariant- und production deployment evidence erledigt sind.

Offen vor Public Go-live:

- Foundry/contract test suite auf finalem Commit.
- Deployment plan und verified addresses.
- Ownership/Timelock/Dual-Control.
- Event-Indexing Compatibility.
- External Audit oder bewusst dokumentierte Canary-Ausnahme mit minimalem Kapital.

## Risiko-Register

### P0 - blockiert Public Go-live

| Risiko | Warum kritisch | Naechster Schritt |
| --- | --- | --- |
| Auth-/RBAC-Rollenmatrix nicht vollstaendig live belegt | Superadmin/Admin-Access ist gruen, aber Register/Login/Reset sowie User-/Viewer-Negativtests schuetzen vor Daten-/Trading-Exposure | Admin/User/Viewer-Smoke ausfuehren und protokollieren |
| Kapital-Flows ohne Canary | Trading/Funding/BotVault koennen reale Verluste verursachen | Kleine limits, Canary-Protokoll, close-only fallback |
| Kapital-Monitoring-Zustellung nicht bewiesen | Read-only Monitoring ist aktiv, aber kapitalbewegende Alerts helfen nur, wenn Ops sie sieht | Trading/Wallet/Grid/BotVault PlatformAlert Smoke |
| Contract Readiness unvollstaendig | Onchain-Fehler sind schwer reversibel | Contract checklist als Release-Gate fuehren |

### P1 - vor breiter Beta klaeren

| Risiko | Warum relevant | Naechster Schritt |
| --- | --- | --- |
| Billing ohne eigenes Go-live-Dokument | Payment/Webhook/Token-Limits sind produktkritisch | Billing status/runbook anlegen |
| Venue Parity nicht final | User koennen Funktionen auf ungeeigneten Venues erwarten | Venue-Freigabematrix aktualisieren |
| Normal Bots noch eingeschraenkt | Automatisierte Strategieausfuehrung braucht Fill-/Signal-Reife | Erst Paper/limited mode freigeben |
| Doku-Drift | Release-Entscheidungen koennen auf alten Status zeigen | Zentrale Evidence-Tabelle pflegen |
| Breite Test-Suite nicht als einheitlicher Release-Check | Einzelchecks sind da, aber Release-Signal ist fragmentiert | Release command matrix einfrieren |

### P2 - nach Canary, vor Skalierung

| Risiko | Warum relevant | Naechster Schritt |
| --- | --- | --- |
| Admin Drilldowns fuer einzelne Stuck-Szenarien lueckenhaft | Operatoren brauchen schnelle Diagnose | Vault Ops/Grid/Admin Details ausbauen |
| Long-run Marktzyklen fehlen | Grid/Trading-Risiken zeigen sich ueber Zeit | 24-48h Beobachtungsfenster |
| Kosten-/Quota-Monitoring fuer AI | Ueberraschende Providerkosten moeglich | Quoten, Alerts, Billing-Verknuepfung |
| CEX Docs verstreut | Ops-Wissen ist vorhanden, aber nicht zentral | CEX docs im Master verlinken |

## Empfohlene Step-by-Step Vorgehensweise

1. Working Tree einfrieren und Evidence-Basis festlegen
   - Branch/Commit fuer die naechsten Smokes definieren.
   - Aktuelle BotVault-Hardening-Aenderungen fertigstellen oder bewusst ausklammern.
   - Go-live-Dokumente mit aktuellem Datum und Commit-SHA aktualisieren.

2. Phase 2 Auth/RBAC/Admin finalisieren
   - Superadmin/Admin-Backend-Access ist am 2026-05-06 erledigt.
   - User login, Register/Verify/Reset, RBAC negative/positive und Audit-Log-Smoke ausfuehren.
   - Ohne Rollenmatrix keine breitere User-Freigabe.

3. Secrets, Provider und Monitoring aktuell halten
   - Production-Secrets, Rotation, AI Provider, FMP/News und Read-only Monitoring sind am 2026-05-06 erledigt.
   - Bei Secret-/Provider-Wechseln wiederholen.
   - Kapitalbewegende PlatformAlert-Zustellung und Closing separat testen.

4. Read-only Feature-Smokes
   - Dashboard, News, Calendar, AI read/generate, Exchange Account connection tests.
   - Ziel: Daten, Degraded States und RBAC ohne Kapitalrisiko pruefen.

5. Trading Desk Paper und Minimal-Live
   - Paper order lifecycle.
   - Pro freigegebener Venue minimaler Live-Order-Canary.
   - Retry/Idempotency/Cancel/Close testen.

6. Wallet/Funding Canary
   - Deposit, withdrawal, Core/EVM, Spot/Perp.
   - Pending/Reconciliation/Recovery-Pfade absichtlich oder kontrolliert beobachten.
   - Alerts und Admin Vault-Ops verifizieren.

7. GridBot Canary
   - Kleines Limit, freigegebene Venue, klare technische Limits.
   - Funding pending, order placement, fills, pause/resume/stop/end.
   - 24-48h Beobachtung vor Skalierung.

8. BotVault E2E Canary
   - Fund -> HyperCore Deposit -> Grid Start -> Orders -> Claim/Close/Recover -> Profitshare.
   - Fresh reconciliation und settlement idempotency beweisen.
   - Contract readiness parallel finalisieren.

9. Billing/Subscription Release Smoke
   - Checkout, webhook, subscription update, token ledger, admin correction.
   - Payment failure/cancel path.

10. Release Review
    - Evidence-Tabelle pruefen.
    - P0 leer, P1 bewusst akzeptiert oder geloest.
    - Master-Plan und Feature-Dokumente synchronisieren.

## Empfohlene Release-Check-Matrix

### Lokal/CI

```bash
npm ci
npm run db:generate
npm -w apps/api run typecheck
npm -w apps/web run typecheck
npm -w apps/runner run typecheck
npm run build
git diff --check
docker compose -f docker-compose.prod.yml config
```

### API und Jobs

```bash
npm -w apps/api run test:auth
npm -w apps/api run test:ai
npm -w apps/api run test:predictions-evaluator
npm -w apps/api run test:predictions-refresh
npm -w apps/api run test:vaults
npm -w apps/api run test:botvault-v4-transitions
npm -w apps/api run test:vault-grid-corewriter
```

### Runner/Exchange

```bash
npm -w apps/runner run test:vault-grid-corewriter
npm -w packages/futures-exchange run test:vault-grid-corewriter
npm -w packages/futures-exchange run build
```

### Web

```bash
npm -w apps/web run test:i18n
npm -w apps/web run typecheck
```

### Python/Strategies

```bash
python -m compileall apps/py-strategy-service
```

### Infra/DB/Contracts

```bash
docker compose -f docker-compose.prod.yml build
npx prisma validate
npx prisma migrate deploy
```

Contract-Checks sollten aus `packages/contracts` final ergaenzt werden, sobald die konkrete Deployment-/Test-Command-Linie feststeht.

## Dokumentationsluecken

Vor Release sollten diese Dokumente ergaenzt oder aktualisiert werden:

- `docs/admin-go-live-status.md`: Node/Web-Typecheck-Status und aktuelles Datum nachziehen.
- Neues `docs/billing-go-live-status.md`: Checkout, Webhooks, Subscriptions, AI Token Ledger, Admin Korrekturen.
- CEX-Rollout-Zusammenfassung: Venue-Freigabe pro Feature und Risk Level.
- `docs/botvault-go-live-followups.md`: aktuelle Hardening-Fixes und Test-Evidence nach finalem Check nachziehen.
- `docs/go-live-master-plan.md`: Evidence-Tabelle mit Commit, Datum, Umgebung, Check, Ergebnis, Verantwortlichem.
- `docs/contract-readiness-checklist.md`: konkrete Deployment-/Audit-/Ownership-Evidence markieren.

## Release-Einschaetzung

| Release-Stufe | Einschaetzung | Voraussetzung |
| --- | --- | --- |
| Lokale technische Readiness | Gut | Dirty Working Tree klaeren, finaler Typecheck/Build |
| Internal read-only Canary | Weitgehend bereit | Read-only Smokes erledigt; RBAC-Rollenmatrix vor breiterer User-Freigabe finalisieren |
| Internal capital Canary | Moeglich nach P0-Fixes | Trading/Wallet/Grid/BotVault kleine Limits, Runbooks, Alerts |
| Private Beta | Noch nicht freigeben | Erfolgreiche 24-48h Canary-Beobachtung und Billing-Smoke |
| Public Go-live | Noch blockiert | Contract readiness, Venue matrix, Ops evidence, P0 leer |

## Naechste konkrete Schritte

1. Aktuelle lokalen BotVault-Hardening-Aenderungen finalisieren und testen.
2. Auth-/RBAC-Rollenmatrix als naechstes echtes Staging-Gate ausfuehren.
3. Secret-/Provider-/Monitoring-Smokes bei jedem Config-/Release-Wechsel erneut protokollieren.
4. Billing-Go-live-Dokument erstellen.
5. Trading, Wallet, GridBot und BotVault in dieser Reihenfolge canary-faehig testen.
6. Master-Plan mit einer Evidence-Tabelle als Single Source of Truth aktualisieren.
