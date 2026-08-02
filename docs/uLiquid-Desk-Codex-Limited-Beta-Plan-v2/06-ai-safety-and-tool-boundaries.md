# Agent 06 – AI Safety and Tool Boundaries

## Auftrag

Prüfe und härte sämtliche AI-Agenten, Tools und Prompt-Flows. Trenne Market Analysis, Prediction Builder und Position Monitoring technisch voneinander. Berücksichtige den Prediction Copier als eigenständige, regelbasierte Runtime und nicht als frei handelnden AI-Agenten.

## Agenten

### Market Analysis Agent

Nur read-only Marktdaten und Prediction-Historie.

### Prediction Builder Agent

Nur Drafts, Validierung und Preview.

### Position Monitoring Agent

Nur Position Snapshot, Marktinformationen und Notification Drafts.

Keiner dieser Agenten erhält Order-, Wallet-, Vault-, Copier-Konfigurations- oder Admin-Schreibtools.

## Prediction Copier Boundary

- Copier verarbeitet bereits validierte Prediction Records.
- Copier darf keinen freien AI-Tool-Loop zur Orderentscheidung verwenden.
- Orderausführung folgt deterministischen Nutzer- und Risiko-Regeln.
- Änderungen an Copier-Regeln benötigen explizite Nutzeraktion.
- AI-Ausgaben allein dürfen niemals Risk Gates überschreiben.

## Aufgaben

- vollständiges Tool Inventory
- Tool-Sicherheitsmatrix
- getrennte Tool Registries
- Server Enforcement
- Prompt-Injection-Schutz
- Output Validation
- Human Confirmation für Konfigurationen
- Logging ohne Secrets
- Rate Limits, Budgets und Iterationslimits
- Prüfung der Copier-Grenze zwischen Prediction und Execution

## Tests

- jeder Agent sieht nur erlaubte Tools
- erfundene Tools werden abgelehnt
- Market Agent kann keine Order ausführen
- Builder kann Copier nicht aktivieren
- Position Agent kann Copier-Regel nicht ändern
- Prompt Injection wird ignoriert
- Cross-user Zugriff wird abgelehnt
- AI kann Risk Gate des Copiers nicht überschreiben
- Secrets erscheinen nicht in Logs

## Akzeptanzkriterien

- dokumentierte Tool-Matrix
- technisch getrennte Rechte
- Copier-Ausführung bleibt deterministisch und regelgebunden
- keine AI-Agenten mit Trading-, Wallet- oder Vault-Schreibrechten
