# uLiquid Desk – Codex Agent Work Package

## Ziel

uLiquid Desk soll kontrolliert als eingeschränkte Beta starten. Der erste öffentliche Produktkern ist ein **AI-assisted multi-exchange trading workspace** mit manueller Kontrolle durch den Nutzer und einem bereits getesteten Prediction Copier.

Im ersten Release enthalten:

- Dashboard und Kontoübersicht
- verbundene Exchange-Konten
- Spot- und Perpetual-Positionen
- manuelles Trading
- Paper Trading
- AI Predictions
- eigener Prediction Builder über AI Chat
- Prediction Copier
- read-only AI Position Copilot
- Kalender, News und Benachrichtigungen
- bestehende eigene Wallet- und Payment-Lösung

Im ersten Release ausdrücklich nicht enthalten:

- öffentliche Grid-Bot-Vaults
- Grid-Bots
- allgemeine vollautomatische Trading-Bots außerhalb des Prediction Copiers
- autonome AI-Orderausführung ohne vorherige Nutzerkonfiguration
- Marketplace-Funktionen

## Wichtige Abgrenzung

Die bestehende eigene Wallet- und Payment-Lösung ist bereits produktseitig integriert. Dieses Arbeitspaket enthält **keine Migration, keinen Provider-Austausch und kein Redesign der Payment-Lösung**. Bestehende Wallet- und Payment-Flows dürfen durch die Arbeiten nicht beeinträchtigt werden.

Der Prediction Copier ist im Limited-Beta-Scope freigegeben. Er gilt als getestete Automationsfunktion, muss jedoch weiterhin durch klare Nutzerfreigabe, Limits, Audit Logs, Kill Switches und serverseitige Sicherheitsprüfungen abgesichert sein.

## Reihenfolge

1. `01-limited-beta-launch-mode.md`
2. `02-ai-predictions-ui-ux.md`
3. `03-ai-prediction-builder-chat.md`
4. `04-prediction-copier.md`
5. `05-position-copilot.md`
6. `06-ai-safety-and-tool-boundaries.md`
7. `07-architecture-refactoring.md`
8. `08-quality-testing-observability.md`
9. `09-beta-release-checklist.md`

## Fortschritt

Stand: 2026-08-02

- [ ] `01-limited-beta-launch-mode.md` – auf Wunsch von Mario zunächst zurückgestellt; muss vor Beta-Freigabe und vor `08`/`09` nachgeholt werden.
- [x] `02-ai-predictions-ui-ux.md` – Predictions UI/UX umgesetzt.
- [x] `03-ai-prediction-builder-chat.md` – AI Prediction Builder Chat umgesetzt.
- [x] `04-prediction-copier.md` – Prediction Copier mit Review-, Aktivierungs- und Execution-Sicherheitsgrenzen umgesetzt.
- [x] `05-position-copilot.md` – read-only Position Copilot für Spot/Perpetual inklusive Triggern, Dedupe, Audit und Benachrichtigungseinstellungen umgesetzt. Nachweis: `docs/tasks/2026-08-02-position-copilot-limited-beta.md`.
- [x] `06-ai-safety-and-tool-boundaries.md` – getrennte AI-Registries, zentrale Tool-Policy, Prompt-/Output-Guards, Secret-Redaction und deterministische Copier-Grenze umgesetzt. Nachweis: `docs/tasks/2026-08-02-ai-safety-tool-boundaries.md`.
- [ ] `07-architecture-refactoring.md` – nächster Arbeitsschritt.
- [ ] `08-quality-testing-observability.md`
- [ ] `09-beta-release-checklist.md`

Die Häkchen dokumentieren den Implementierungsstand dieses Arbeitspakets. Eine Beta-Freigabe ist damit ausdrücklich noch nicht erteilt; dafür bleiben insbesondere `01`, `07`, `08` und `09` offen.

## Arbeitsregeln für alle Codex-Agenten

- Vor Änderungen zuerst bestehende Implementierung, Tests und Dokumentation lesen.
- Bestehende funktionierende Architektur bevorzugen; keine unnötige Neuentwicklung.
- Bestehende eigene Wallet- und Payment-Lösung nicht umbauen.
- AI darf niemals ohne zuvor vom Nutzer konfigurierte und freigegebene Automationsregeln handeln.
- Der Prediction Copier darf nur innerhalb seiner expliziten Nutzerkonfiguration Orders ausführen.
- Alle Trading-Aktionen benötigen serverseitige Berechtigungen, Risiko-Gates und Audit Logging.
- Feature-Gating muss serverseitig durchgesetzt werden. Reines Ausblenden in der UI genügt nicht.
- Neue APIs mit Authentifizierung, Autorisierung, Schema-Validierung, Rate Limits und Audit Logging versehen.
- Bestehende i18n-Struktur für Deutsch und Englisch verwenden.
- Mobile und Desktop berücksichtigen.
- Bestehende Tests erweitern und neue Tests ergänzen.
- Keine großflächigen Änderungen außerhalb des jeweiligen Themenbereichs.
- Nach jeder Aufgabe dokumentieren: geänderte Dateien, Architekturentscheidungen, Tests und bekannte Restpunkte.

## Gemeinsame Definition of Done

Eine Aufgabe gilt erst als abgeschlossen, wenn:

- die Implementierung vollständig integriert ist,
- Typecheck und relevante Tests erfolgreich sind,
- neue kritische Pfade getestet sind,
- UI-Zustände für Loading, Empty, Error und Degraded vorhanden sind,
- Prediction-Copier-Ausführung nur innerhalb bestätigter Nutzerregeln möglich ist,
- keine unerlaubten AI-Schreibrechte auf Trading- oder Wallet-Funktionen eingeführt wurden,
- bestehende Wallet- und Payment-Flows unverändert funktionieren,
- Dokumentation aktualisiert wurde,
- ein kurzer manueller Smoke-Test beschrieben wurde.
