# Codex Master Prompt – uLiquid Desk Limited Beta

Du arbeitest im Repository von uLiquid Desk. Ziel ist ein kontrollierter Limited-Beta-Start als AI-assisted Multi-Exchange Trading Workspace.

## Produktumfang

Freigegeben:

- Dashboard
- Exchange-Konten
- Spot- und Perp-Positionen
- Manual Trading
- Paper Trading
- AI Predictions
- Prediction Builder Chat
- Prediction Copier
- read-only Position Copilot
- News, Kalender und Benachrichtigungen
- bestehende eigene Wallet- und Payment-Lösung

Nicht freigegeben:

- Grid Bots
- Vaults
- allgemeine Trading Bots außerhalb des Prediction Copiers
- autonome AI-Trading-Agenten
- Marketplace

## Payment-Status

Die aktuelle eigene Wallet- und Payment-Implementierung ist bestehende Infrastruktur und nicht Teil dieses Arbeitspakets. Verändere sie nicht und stelle durch Regressionstests sicher, dass sie weiterhin funktioniert.

## Prediction Copier

Der Prediction Copier ist bereits getestet und Teil der Limited Beta. Er darf ausschließlich innerhalb explizit vom Nutzer bestätigter Regeln handeln. Jede Ausführung muss serverseitig risikogeprüft, idempotent, auditiert und durch Kill Switches kontrollierbar sein.

Der Prediction Copier ist keine frei entscheidende AI-Agentenfunktion. AI erzeugt Predictions; die Copier-Runtime bewertet sie deterministisch anhand Nutzer- und Risiko-Regeln.

## Verbindliche Sicherheitsregeln

1. AI-Agenten dürfen niemals selbständig Orders ausführen.
2. AI-Agenten erhalten keine Trading-, Wallet-, Vault-, Copier-Konfigurations- oder Admin-Schreibtools.
3. Der Prediction Copier darf nur bestätigte Nutzerregeln ausführen.
4. Jede Copier-Ausführung benötigt Risk Gates, Idempotenz und Audit Logging.
5. Feature-Gating wird serverseitig erzwungen.
6. UI-Ausblenden allein ist keine Sicherheitsmaßnahme.
7. Nutzer- und Account-Grenzen sind auf jeder API zu prüfen.
8. Alle Inputs und AI Outputs werden per Schema validiert.
9. Keine Secrets in Prompts, Snapshots, Logs oder Fehlermeldungen.
10. Bestehende Tests und Architektur zuerst prüfen und bevorzugt erweitern.

## Arbeitsweise

1. Lies `README.md` dieses Arbeitspakets.
2. Bearbeite die Agent-Dateien in numerischer Reihenfolge oder nur die zugewiesene Datei.
3. Erstelle vor Implementierung eine Bestandsaufnahme der betroffenen Dateien und Tests.
4. Implementiere in kleinen, überprüfbaren Schritten.
5. Ergänze Tests.
6. Führe Typecheck, relevante Tests und Smoke-Tests aus.
7. Dokumentiere Änderungen, Entscheidungen, Tests und offene Risiken.

## Definition of Done

- Anforderungen und Akzeptanzkriterien erfüllt
- Typecheck erfolgreich
- relevante Tests erfolgreich
- keine Regression in Manual Trading, Paper Trading, Prediction-Auswertung, Prediction Copier oder bestehender Payment-Lösung
- Grid und Vaults bleiben deaktiviert
- keine autonomen AI-Trading-Rechte
- Dokumentation aktualisiert
