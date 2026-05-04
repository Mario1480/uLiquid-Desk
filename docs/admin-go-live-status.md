# Admin Go-Live Status

Stand: 2026-05-03

## Kurzstatus

Status: **bedingt go-live-ready** fuer den Admin-Fixumfang.

Die vier Review-Findings sind im Code behoben und API-seitig verifiziert. Der direkte Web-Typecheck ist gruen. Der volle Next.js-Web-Typecheck ist lokal noch offen, weil die aktuelle Node-Version `18.20.8` ist und Next.js `>=20.9.0` verlangt.

## Behobene Findings

1. **Billing Token Adjust**
   - Web sendet `deltaTokens` jetzt als getrimmten Integer-String.
   - Leere oder ungueltige Token-Deltas sowie fehlende Notizen werden clientseitig blockiert.
   - API akzeptiert `deltaTokens` robust als String oder Number und normalisiert auf String.
   - Test ergaenzt: String- und Number-Payloads fuer Token-Adjust.

2. **Zentrale Superadmin-Erkennung**
   - Neuer gemeinsamer Helper `auth/superadmin.ts`.
   - `ADMIN_EMAIL` ist die fuehrende Quelle und darf kommasepariert sein.
   - `SUPERADMIN_EMAIL` bleibt Backwards-Compatibility-Fallback.
   - `auth.ts`, `index.ts`, Grid-Admin-Viewer, Grid-Hyperliquid-Pilot-Access und Admin-Seeding nutzen die gleiche Logik.
   - Admin-Seeding nimmt bei mehreren Admin-Adressen die erste konfigurierte Adresse.

3. **Admin-Listen-Pagination**
   - Users, Workspaces, Licenses und Bots nutzen jetzt DB-nahe `count`, `skip` und `take`.
   - Filter fuer User-Status, User-Rolle, License-Status, Workspace-Status, Workspace-License-Status und Bot-Strategy werden in Prisma-Where-Clauses uebersetzt.
   - Runners paginieren Runner-Nodes ueber die DB und laden BotRuntime-Joins nur fuer die aktuelle Seite.
   - Response-Shape und Pagination-Shape bleiben unveraendert.
   - Tests ergaenzt fuer Query-Shape, Pagination und Runtime-Join-Begrenzung.

4. **Stale Duplicate-Dateien**
   - Aus dem Working Tree entfernt:
     - `apps/web/app/admin/page 2.tsx`
     - `apps/web/app/admin/exchanges/page 2.tsx`
     - `apps/web/app/admin/vault-operations/page 2.tsx`
     - `apps/api/src/billing/ccpayment 2.ts`
   - `rg` findet keine Runtime-Imports oder Code-Referenzen auf diese Dateien; nur Dokumentation nennt sie noch.

## Gepruefte Admin-Flaechen

- Admin Billing: Packages, manuelle AI-Token-Anpassung, Feature-Flags.
- Auth/Admin Guards: RBAC-Permissions, Superadmin-E-Mail-Parsing, Admin-Backend-Access.
- Grid Admin Access: Grid-Admin-Viewer und Grid-Hyperliquid-Pilot-Access.
- Platform Admin: Users, Workspaces, Licenses, Bots, Runners.
- Admin Operations: Vault Ops, Telegram-Operations, External Health.

## Ausgefuehrte Checks

| Check | Ergebnis |
| --- | --- |
| `npm -w apps/api run typecheck` | PASS |
| `node ../../node_modules/tsx/dist/cli.mjs --test src/billing/routes.test.ts src/auth/superadmin.test.ts src/auth/permissions.test.ts src/admin/routes-platform.test.ts src/admin/routes-vault-operations.test.ts src/admin/routes-operations.telegram.test.ts src/admin/externalHealth.test.ts` | PASS, 24 Tests |
| `node ../../node_modules/typescript/bin/tsc --noEmit --incremental false -p tsconfig.json` in `apps/web` | PASS |
| `npm -w apps/web run typecheck` | BLOCKED lokal: Node `18.20.8`, Next.js verlangt `>=20.9.0` |
| `git diff --check` | PASS |
| `rg` auf die entfernten Duplicate-Dateinamen | PASS, nur Doku-Treffer |

## Offene Punkte vor Go-Live

- **Full-Web-Typecheck mit Node >=20.9.0 ausfuehren.** Lokal blockiert `npm -w apps/web run typecheck` wegen Node `18.20.8`.
- **Deletion-Index finalisieren.** Die Admin/Billing-Duplikate und die zwei weiteren `* 2.*` Duplikate sind im Working Tree geloescht; vor Merge/Commit muessen die Deletions gestaged/committed werden. Bis dahin zeigt `git ls-files '* 2.tsx' '* 2.ts'` sie weiterhin als getrackte Index-Eintraege.
- **Staging-Smoke mit realistischen Daten ausfuehren.** Besonders die neuen Prisma-Filter fuer Admin-Listen sollten einmal gegen produktionsnahe Datenmengen und Indizes validiert werden.

## Review-Ergebnis

Diff-orientiertes Nachreview der betroffenen Admin-Flaechen: keine neuen blockierenden Findings im Fixumfang. Die offenen Punkte oben sind Go-live-Prozess-Checks, keine neuen bekannten Runtime-Bugs aus dem Review.
