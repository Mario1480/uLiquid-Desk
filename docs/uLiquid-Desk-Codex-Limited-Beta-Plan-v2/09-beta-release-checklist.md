# Agent 09 – Limited Beta Release Checklist

## Auftrag

Bereite den kontrollierten Limited-Beta-Release vor und liefere eine überprüfbare Go-live-Entscheidung.

## Produktumfang

Aktiv:

- Auth und Benutzerkonto
- Dashboard
- Exchange-Konten
- Spot- und Perp-Positionen
- Manual Trading
- Paper Trading
- AI Predictions
- Prediction Builder Chat
- Prediction Copier
- Position Copilot read-only
- News und Kalender
- Benachrichtigungen
- bestehende eigene Wallet- und Payment-Lösung

Deaktiviert:

- Grid Bots
- Vaults
- allgemeine automatische Bot-Ausführung außerhalb des Prediction Copiers
- autonome AI-Trading-Agenten
- Marketplace

## Security

- [ ] Feature-Gates serverseitig aktiv
- [ ] Grid/Vault APIs blockiert
- [ ] deaktivierte Jobs starten nicht
- [ ] Prediction Copier in Allowlist und Runtime aktiv
- [ ] Copier-Regeln benötigen explizite Nutzerbestätigung
- [ ] Copier Idempotenz getestet
- [ ] globale und nutzerbezogene Kill Switches getestet
- [ ] AI Tool Allowlist geprüft
- [ ] keine AI Trading-/Wallet-Schreibtools
- [ ] Rate Limits aktiv
- [ ] Tenant- und Account-Checks aktiv
- [ ] Secrets nicht in Logs

## Trading und Prediction Copier

- [ ] unterstützte Exchanges klar ausgewiesen
- [ ] Capability Matrix aktuell
- [ ] Paper und Live eindeutig unterscheidbar
- [ ] Copier-Symbol-/Markt-Allowlist aktiv
- [ ] Confidence-Schwelle aktiv
- [ ] Position-, Exposure-, Leverage- und Tagesverlustlimits aktiv
- [ ] Stop-/Target-Plausibilität geprüft
- [ ] abgelaufene und `no_trade` Predictions werden nie ausgeführt
- [ ] jede Prediction wird pro Regel höchstens einmal ausgeführt
- [ ] unbekannter Orderstatus erzeugt keine Doppelorder
- [ ] Partial Fill Verhalten getestet
- [ ] Skip-Gründe sichtbar
- [ ] Betreiber-Kill-Switch vorhanden

## AI Predictions

- [ ] Schema-Validierung aktiv
- [ ] ungültige Levels werden abgelehnt
- [ ] Datenqualität sichtbar
- [ ] Disclaimer sichtbar
- [ ] Preview erzeugt keine aktive Prediction
- [ ] Copier-Konfiguration ist separater Review-Flow
- [ ] Prediction- und Copier-Performance getrennt

## Position Copilot

- [ ] read-only technisch erzwungen
- [ ] keine Secrets im Snapshot
- [ ] Trigger und Cooldowns getestet
- [ ] keine Änderung an Copier-Regeln möglich
- [ ] CTA führt nichts automatisch aus

## UX

- [ ] Desktop und Mobile getestet
- [ ] Loading, Empty, Error, Degraded vorhanden
- [ ] Deutsch und Englisch vollständig
- [ ] Navigation zeigt Prediction Copier
- [ ] Navigation zeigt keine Grid-/Vault-Funktionen
- [ ] Deep Links werden korrekt behandelt

## Operations

- [ ] Produktionskonfiguration dokumentiert
- [ ] Prediction Copier Runtime überwacht
- [ ] DB Backup und Restore getestet
- [ ] Monitoring und Alerts aktiv
- [ ] Rollback-Prozess dokumentiert
- [ ] Incident Contact festgelegt
- [ ] bestehender Wallet- und Payment-Flow erfolgreich getestet

## Legal und Kommunikation

- [ ] Terms sichtbar
- [ ] Privacy sichtbar
- [ ] Trading Risk Disclaimer sichtbar
- [ ] AI Disclaimer sichtbar
- [ ] Beta-Hinweis sichtbar
- [ ] Prediction Copier als automatisierte, nutzerkonfigurierte Funktion erklärt
- [ ] keine Erfolgsversprechen

## Rollout

### Stufe 1 – Internal

- Betreiber und engste Tester
- kleine Konten
- tägliche Log-Prüfung
- konservative Copier-Limits

### Stufe 2 – Invite-only

- begrenzte Nutzerzahl
- Feedback-Kanal
- tägliche Fehler-, Kosten- und Copier-Ausführungsprüfung

### Stufe 3 – Expanded Beta

Nur bei stabilen Exchange-Abfragen, akzeptabler AI-Fehlerquote, keiner Doppelorder, funktionierenden Kill Switches und erfolgreichem Restore.

## Abbruchkriterien

- unautorisierte Trading-Aktion
- Doppelorder
- Cross-User-Datenzugriff
- falsche Account-Zuordnung
- AI erhält unerlaubte Tools
- Copier ignoriert Nutzer- oder Risk Limits
- unkontrollierter Kostenanstieg
- Datenverlust oder nicht funktionierender Restore

## Abschlussbericht

Erstelle `docs/limited-beta-readiness-report.md` mit Scope, Build/Teststatus, offenen Risiken, Runtime-Status, Rollback-Status und Empfehlung `Go`, `Conditional Go` oder `No-Go`.

## Akzeptanzkriterien

- alle Checklistenpunkte mit Beleg oder bewusstem Risiko versehen
- Prediction Copier ist vollständig in Go-live-Prüfung enthalten
- Grid und Vaults bleiben deaktiviert
- bestehende eigene Payment-Lösung bleibt unverändert und getestet
