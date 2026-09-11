# Codex Master Prompt – FMP Replacement

Arbeite im Repository `uLiquid-Desk` und setze das Paket `uLiquid Desk – FMP Replacement & AI Market Intelligence` um.

## Vorgehensweise

1. Lies zuerst `00-README-MASTER-PLAN.md`.
2. Untersuche den aktuellen Code und gleiche alle genannten Pfade mit dem realen Repository ab.
3. Erstelle vor Änderungen eine kurze Impact Map aller FMP-Abhängigkeiten.
4. Bearbeite die Agent-Dateien in der angegebenen Reihenfolge oder verteile sie auf getrennte Worktrees/Branches.
5. Verändere keine Payment-, Billing-, Grid-, Vault- oder Trade-Execution-Funktionen, außer ein Build erfordert einen rein typischen Import-Fix.
6. Bewahre Rückwärtskompatibilität der bestehenden News- und Kalender-APIs während der Migration.
7. Entferne FMP erst, wenn der Legacy-Adapter per Feature Flag deaktivierbar ist und alle Verbraucher migriert sind.
8. Verwende offizielle oder ausdrücklich freigegebene Quellen. Aktiviere keine Quelle produktiv, deren Nutzung nicht manuell geprüft wurde.
9. AI bleibt read-only. Registriere keine Trading-, Wallet- oder Bot-Schreibtools für Market Summaries oder News Analysis.
10. Schreibe Tests für Happy Path, Partial Failure, Total Failure, stale data und malformed provider payloads.

## Technische Leitplanken

- TypeScript strict beibehalten.
- Keine neuen `any` an Provider- oder Persistenzgrenzen.
- Zod oder bestehende Schema-Technik für externe Payloads verwenden.
- Externe Daten immer als untrusted input behandeln.
- Provider-Rohpayloads nicht direkt an das Web weiterreichen.
- UTC intern, lokalisierte Darstellung nur im Client.
- Background Jobs idempotent implementieren.
- Logs ohne API Keys, Feed Credentials oder vollständige externe Payloads.
- Providerfehler über strukturierte Health States abbilden.

## Erwartete Outputs

- produktionsfähiger Code
- Prisma-Migrationen, falls erforderlich
- aktualisierte `.env.example` und `.env.prod.example`
- aktualisierte deutsche und englische Übersetzungen
- Unit-/Integration-/E2E-Smokes
- Migrationsdokumentation
- Rollback-Anleitung
- Liste manuell zu prüfender Datenquellen und Nutzungsbedingungen

## Abschlussbericht

Liefere:

1. geänderte Architektur
2. geänderte Dateien
3. neue Provider und deren Aktivierungsstatus
4. Tests und Ergebnisse
5. offene Lizenzprüfungen
6. bekannte Einschränkungen
7. exakte Schritte für Staging und Production Rollout
