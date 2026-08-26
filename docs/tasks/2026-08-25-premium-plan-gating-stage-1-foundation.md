# Premium Plan Gating – Stage 1 Foundation

Datum: 2026-08-25
Status: Code und Migration-Datei erstellt; Migration und Deployment nicht ausgeführt

## Ergebnis

Stage 1 ist als additive Foundation umgesetzt:

- Plan-Rangfolge: `free < pro < premium < enterprise`.
- Unbekannte kommerzielle oder Strategy-Planwerte fallen fail-safe auf Free zurück.
- Billing ist für Free/Pro/Premium die kommerzielle Plan-Autorität.
- Nur ein expliziter bestehender Enterprise-License-Eintrag darf den kommerziellen Capability-Plan auf Enterprise erweitern.
- Credit-Balance und Promo-/Monthly-Credits erhöhen den Capability-Plan nicht mehr im Workspace-Sync.
- Der zentrale `ResolvedEntitlementContext` bündelt Commercial Plan, Capability Plan, Enterprise-Override, Capabilities, Quotas und Usage; der Subscription-API-Contract liefert ihn additiv als `entitlements`.
- Premium ist in Core-, API-, Strategy-, Plugin-, Runner- und Web-Vertragstypen enthalten.
- `proValidUntil` bleibt als Kompatibilitätsalias bestehen; `planValidUntil` wird additiv geliefert.
- Enterprise behält seine spezifische Strategy-Grenze von 64 Composite Nodes und wird vom Billing-Sync nicht überschrieben.

Die Stage-1-Änderung verändert die bestehende Pro-Featurematrix bewusst noch nicht. Free-Grid/Prediction-Copier, neue enge AI-Capabilities, Quota-Admission und Pricing-/UI-Änderungen gehören zu Stage 2 bis 5.

## Datenmodell

Das Prisma-Schema enthält additiv:

- `EffectivePlan.PREMIUM`
- `UserSubscription.planValidUntil`
- `UserSubscription.maxExchangeAccounts`
- `BillingPackage.maxExchangeAccounts`
- `SubscriptionTerm.plan`
- Index auf `(effectivePlan, planValidUntil)`; der alte Pro-Index bleibt erhalten.

Die noch nicht ausgeführte Migration liegt unter:

`prisma/migrations/20260825120000_premium_plan_entitlement_foundation/migration.sql`

Sie führt ausschließlich Expand-/Kompatibilitätsarbeit aus:

- ergänzt den Enum-Wert und nullable Spalten,
- kopiert vorhandenes `pro_valid_until` nach `plan_valid_until`,
- klassifiziert ausschließlich bekannte Legacy-Term-Snapshots `FREE`/`PRO`,
- lässt unbekannte Term-Pläne `NULL` statt sie still auf Pro/Premium zu heben,
- legt keinen Premium-Tarif und keine Premium-Subscription an,
- löscht oder ersetzt keine Orders, Credits, Grants, Terms oder Enterprise-Licenses.

## Read-only Daten-Census

Der optionale Census wurde ausschließlich gegen die in `.env` konfigurierte lokale PostgreSQL-Adresse `localhost:5433/mm` in einer Read-only-Transaktion versucht. Ergebnis:

- lokale Datenbank nicht erreichbar (`P1001`),
- keine Datenänderung,
- kein Start eines lokalen DB-/Docker-Stacks,
- keine Verbindung zu Staging oder Production,
- Enterprise-, Plan-, Term-, Add-on- und Account-Bestände bleiben für reale Zielumgebungen unbekannt.

Vor jeder Ausführung der Migration bleibt Gate A aus Stage 0 verbindlich: Zielumgebungs-Census, Backup-/Restore-Evidence und Klassifikation unbekannter Planwerte.

## Ausführungsplan für die Migration

Nur nach separater Freigabe:

1. Zielumgebung eindeutig benennen und Read-only Census plus Backup-/Restore-Evidence abschließen.
2. Temporäre PostgreSQL-Kopie mit repräsentativen Free-/Pro-/Enterprise-/Term-/Order-/Credit-Fixtures erstellen.
3. Migration dort einmal anwenden und Aggregate/Referenzen vor und nachher vergleichen.
4. Wiederholungs-/Idempotenzverhalten der Backfill-Statements prüfen.
5. Erst danach Expand-Migration auf isoliertem Staging anwenden.
6. Premium-kompatiblen Code nach erfolgreicher Migration deployen; noch keine Premium-Pakete aktivieren.
7. Staging-Smokes und Enterprise-Evidence dokumentieren.

Rollback ist expand-sicher: Bei einem Codeproblem wird der Code zurückgerollt; Enum-Wert und nullable Spalten bleiben zunächst bestehen. Ein destruktives Entfernen von `PREMIUM` oder Spalten ist nicht Teil des Rollbacks.

## Verifikation

Erfolgreich:

- `npx prisma validate --schema prisma/schema.prisma`
- `npm run db:generate`
- `npm -w packages/core run build`
- `npm -w apps/api run typecheck`
- `npm -w apps/runner run typecheck`
- `npm -w apps/web run typecheck`
- `npm -w apps/api run test:billing` – 104 Tests grün
- Core Capability Tests – 5 Tests grün
- Billing-authoritative Context Tests – grün
- Plugin Premium-Snapshot Tests – grün
- License/Strategy Tests – grün; erwartete lokale DB-Unavailable-Logs aus dem fail-safe Override-Read
- `git diff --check`

Nicht vollständig abgeschlossen:

- Der Root-Typecheck lief bis `@mm/futures-exchange` und stagnierte dort ohne Fehlermeldung; er wurde kontrolliert abgebrochen. Die geänderten Workspaces API, Runner, Web und Core wurden separat erfolgreich geprüft.
- Der isolierte Runner-Resolution-Testprozess blieb beim Modul-Laden ohne Testergebnis stehen und wurde abgebrochen; Runner-Typecheck und Plugin-Contract-Typecheck sind grün.
- Ein echter Migrationstest gegen eine temporäre PostgreSQL-Datenbank ist mangels laufender lokaler Instanz offen.

## Nicht ausgeführt

- keine Prisma-Migration (`migrate dev`, `migrate deploy`, SQL-Ausführung),
- kein Seed oder Daten-Backfill gegen eine Datenbank,
- kein Staging-/Production-Census,
- kein Deployment,
- kein Commit oder Push,
- keine Premium-Paketaktivierung,
- keine Onchain- oder Provider-Aktion.

## Nächster Gate-Schritt

Stage 2 ist die Quota-/Free-Automation-Implementierung. Vorher sind die offenen Produktentscheidungen aus Stage 0 erforderlich, insbesondere die Paper-Account-Zählregel. Migration oder Deployment bleiben davon getrennte Freigaben.
