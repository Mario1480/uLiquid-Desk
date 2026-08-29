# Premium Plan Gating – Stage 2 Quotas und Free-Automation

Datum: 2026-08-25
Status: Code und Tests umgesetzt; Migration, Daten-Backfill und Deployment nicht ausgeführt

## Ergebnis

Stage 2 ist als serverseitige Quota- und Free-Grid-Foundation umgesetzt:

- Trading Bots, Grid Bots und Prediction Copier nutzen denselben aktiven Bot-Slot-Pool.
- Als aktiv und quota-relevant gilt zentral ausschließlich `status = running`; Paused, Stopped, Draft, Error und andere Zustände zählen nicht.
- Bot-Start, Grid-Start/Resume, Prediction-Schedule-Aktivierung und Exchange-Account-Erstellung werden je User und Quota-Bucket durch eine PostgreSQL-Transaktionssperre serialisiert.
- Bestehende Over-limit-Bots, Schedules oder Exchange Accounts werden weder gelöscht noch automatisch gestoppt.
- Bereits laufende Prediction Schedules bleiben nach einem Downgrade verwaltbar und verbrauchen beim unveränderten Speichern keinen zusätzlichen Slot. Eine neue Aktivierung oder ein Resume benötigt dagegen freie Kapazität.
- Paper-Accounts sind gemäß Produktfreigabe vom Exchange-Account-Limit ausgeschlossen.
- Der Grid-Provisionierungsfluss besitzt eng begrenzte Grid-Routen, ohne die allgemeine Vault-Produktoberfläche für Free freizugeben.

## Quota-Basismodell

Die Code-Fallbacks und Tests bilden die freigegebene Matrix ab:

| Plan | Reale Exchange Accounts | Running Bots gesamt | AI Schedules | Composite Schedules |
| --- | ---: | ---: | ---: | ---: |
| Free | 1 | 2 | 0 | 0 |
| Pro | unbegrenzt (`null`) | 5 | 3 | 2 |
| Premium | unbegrenzt (`null`) | 15 | 10 | 5 |

Diese Werte ersetzen in Stage 2 noch keine bereits gespeicherten Package-, Subscription- oder Term-Snapshots. Der kontrollierte Canonical-Package-Abgleich und Daten-Backfill bleiben Stage 4 und benötigen eine separate Freigabe.

## Serialisierte Admission

Der zentrale Service unter `apps/api/src/admission/quotaAdmission.ts` verwendet pro User und Bucket `pg_advisory_xact_lock` innerhalb einer Prisma-Transaktion. Count, Entscheidung und persistierte Zustandsänderung beziehungsweise Erstellung liegen damit unter derselben Sperre.

Abgedeckte Pfade:

- normaler Bot-Start einschließlich Prediction Copier,
- Grid Create-Autostart, Start und Resume,
- Aktivierung und Resume von AI-/Composite-Prediction-Schedules,
- finale persistierte Schedule-Erstellung im Prediction-Generate-Pfad,
- Erstellung realer Exchange Accounts.

Admin-Backend-Bypass bleibt erhalten. Er umgeht nur die Quota-Entscheidung, nicht Authentifizierung, Ownership oder die serialisierte Zustandsänderung.

## Paper-Account-Regel

Für `maxExchangeAccounts` zählen ausschließlich reale Exchange-Account-Rows. `exchange = paper` wird case-insensitiv ausgeschlossen.

- Free kann damit einen realen Market-Data-/Execution-Account und den davon abhängigen Paper Account gemeinsam nutzen.
- Ein zweiter realer Account wird bei Limit 1 mit dem stabilen Fehlercode `max_exchange_accounts_exceeded` abgewiesen.
- Reads, Updates, Tests und Deletes bestehender Accounts bleiben möglich; überzählige Bestände werden nicht verändert.
- Pro und Premium bleiben bei `maxExchangeAccounts = null` kommerziell unbegrenzt. Ein separates internes Fair-Use-/Abuse-Limit ist nicht Bestandteil dieser Stage.

## Free-Grid-Abhängigkeiten

Die Grid-Web-Flows verwenden für Onchain-Provisionierung jetzt Grid-spezifische Endpunkte:

- `GET /grid/onchain/actions`
- `POST /grid/instances/:id/onchain/reserve-tx`
- `POST /grid/instances/:id/onchain/fund-hypercore-tx`
- `POST /grid/instances/:id/onchain/actions/:actionId/submit-tx`
- `POST /grid/instances/:id/onchain/actions/:actionId/fail-tx`

Diese Endpunkte verlangen weiterhin Authentifizierung, Grid-Feature/-Capability, Ownership der Grid Instance, die zugehörige BotVault-Beziehung und einen freigegebenen Grid-Provisionierungsaktionstyp. Reserve- und HyperCore-Funding-Builds sind zusätzlich auf ihre exakte Pending-Signature-Phase begrenzt. Claim-, Close-, FundingVault-Withdraw- und Treasury-Aktionen sind über diese Grid-Routen nicht zulässig.

Optionale Reads der allgemeinen wiederverwendbaren BotVault-Liste blockieren den Grid-Create-Flow bei einem Vault-Capability-Denial nicht mehr. Die allgemeinen `/vaults/*`-Routen und das Gate `product.vaults` wurden nicht geöffnet oder abgeschwächt.

Die tatsächliche Freischaltung der Capabilities `product.grid_bots`, Prediction Copier und der erforderlichen Execution-Plugins für Free gehört laut Stufenplan zu Stage 3. Stage 2 stellt den dafür notwendigen autorisierten End-to-End-Datenpfad bereit, aktiviert die Free-Capability aber noch nicht.

## Enterprise-Kompatibilität

- Enterprise bleibt ein eigener interner Capability-Tier oberhalb Premium und wird nicht in einen kommerziellen Premium-Plan umgedeutet.
- Enterprise-Capabilities und die bestehende 64-Composite-Node-Regel aus Stage 1 bleiben erhalten.
- Kommerzielle Quotas werden weiterhin aus dem Billing-Plan, unveränderlichen Term-Snapshots und planbezogenen Capacity-Grants aufgelöst. Ein Enterprise-Capability-Override erzeugt nicht stillschweigend neue Billing-Quotas.
- Der Billing-Sync überschreibt keinen expliziten Enterprise-License-Eintrag.
- Der reale Enterprise-Datenbestand bleibt ohne Read-only Zielumgebungs-Census unbekannt.

## Verifikation

Erfolgreich:

- Stage-2-Zieltests für Admission, Bot-, Grid-, Exchange-Account- und Prediction-Pfade: 54/54 grün.
- Vollständige API-Billing-Suite: 106/106 grün.
- Core-/Capability-/License-/Plugin-Vertragstests: 29/29 grün.
- Grid-Routen plus Grid-Lifecycle: 24/24 grün.
- `npm -w apps/api run typecheck`
- `npm -w apps/web run typecheck`
- `git diff --check`

Die Concurrency-Tests belegen insbesondere:

- Zwei parallele Bot-Starts bei einem freien Slot lassen genau einen Start zu.
- Zwei parallele reale Account-Erstellungen bei Limit 1 legen genau einen Account an.
- Ein Paper Account wird danach weiterhin zugelassen und nicht gezählt.
- Zwei parallele AI-Schedule-Aktivierungen bei einem freien Slot aktivieren genau einen Schedule.

## Bewusst offen

- Kein Read-only Zielumgebungs-Census; der zuletzt erlaubte lokale Versuch aus Stage 1 scheiterte read-only an `localhost:5433/mm` mit `P1001`.
- Kein Test gegen eine echte PostgreSQL-Instanz; die Sperrsemantik ist durch Unit-/Concurrency-Tests und Typechecks geprüft, benötigt vor Rollout aber Integrations-Evidence auf einer temporären PostgreSQL-Kopie.
- Keine Stage-3-Capability-Aktivierung für Free.
- Keine Canonical-Package-Erstellung, kein Package-/Subscription-/Term-Backfill und keine Premium-Checkout-Aktivierung.
- Keine vollständige Browser-E2E-Prüfung des Free-Grid-Flows, solange Capability-Aktivierung, Migration und repräsentative Daten bewusst fehlen.

## Nicht ausgeführt

- keine Prisma-Migration oder SQL-Ausführung,
- kein Seed, Census-Write oder Daten-Backfill,
- kein Start eines lokalen DB-/Docker-Stacks,
- kein Deployment,
- kein Commit oder Push,
- keine Onchain-, Wallet-, Provider- oder Production-Aktion.

Die in Stage 1 erzeugte Migration bleibt unverändert und nicht ausgeführt:

`prisma/migrations/20260825120000_premium_plan_entitlement_foundation/migration.sql`
SHA-256: `2576c3cfd5e19b08e275ea19fd29cc9b80274d70059ed0202068e243a31928fb`

## Nächster Gate-Schritt

Stage 3 ergänzt und aktiviert die engen AI-/Capability-Gates sowie Free Grid/Prediction Copier. Dafür ist eine neue ausdrückliche Freigabe erforderlich. Migration, Stage-4-Backfill und Deployment bleiben davon getrennte Gates.
