# Agent 01 – Limited Beta Launch Mode

## Auftrag

Implementiere einen zentralen, serverseitig erzwungenen Betriebsmodus für den eingeschränkten Beta-Start von uLiquid Desk.

## Zielbild

Der Modus `limited_beta` erlaubt die freigegebenen Kernfunktionen einschließlich Prediction Copier. Grid-Bots, Vaults, Marketplace und sonstige automatische Bot-Runtimes dürfen weder über UI, Deep Links, API noch Background Jobs nutzbar sein.

## Freigegebene Features

- Dashboard
- Manual Trading
- Paper Trading
- AI Predictions
- Prediction Builder
- Prediction Copier
- Position Copilot
- News und Kalender
- bestehende Wallet- und Payment-Lösung

## Deaktivierte Features

- Grid Bots
- Vaults
- Vault Jobs
- allgemeine Automated Bots außerhalb des Prediction Copiers
- Marketplace

## Vorgeschlagene Konfiguration

```env
PUBLIC_LAUNCH_MODE=limited_beta
GRID_BOTS_ENABLED=false
VAULTS_ENABLED=false
VAULT_JOBS_ENABLED=false
AUTOMATED_BOTS_ENABLED=false
PREDICTION_COPIER_ENABLED=true
AI_POSITION_COPILOT_ENABLED=true
```

Nutze eine typisierte zentrale Konfiguration statt verstreuter `process.env`-Abfragen.

## Anforderungen

### 1. Zentrale Feature Registry

Mindestens:

- `dashboard`
- `manual_trading`
- `paper_trading`
- `ai_predictions`
- `prediction_builder`
- `prediction_copier`
- `position_copilot`
- `automated_bots`
- `grid_bots`
- `vaults`
- `marketplace`

Pro Feature:

- öffentliche Verfügbarkeit
- Server-Verfügbarkeit
- Admin-Verfügbarkeit
- benötigte Rolle oder Lizenz
- Launch-Modus
- Runtime-/Job-Abhängigkeiten

### 2. Serverseitige Durchsetzung

Deaktivierte Features müssen auf API-Ebene blockiert werden.

```json
{
  "error": "feature_disabled",
  "feature": "grid_bots",
  "launchMode": "limited_beta"
}
```

Prediction-Copier-Endpunkte müssen in `limited_beta` erreichbar bleiben, sofern Nutzerberechtigungen und Produkt-Gates erfüllt sind.

### 3. Background Jobs

Nicht starten:

- Vault On-chain Indexer
- Vault Reconciliation
- Vault Risk Jobs
- Grid Runtime Jobs
- allgemeine Bot Runner, sofern nicht für den Prediction Copier benötigt

Weiterhin starten:

- Prediction Copier Runtime
- Prediction Evaluation
- notwendige Notification- und Monitoring-Jobs

Beim Start strukturiert loggen, welche Jobs aktiv und deaktiviert sind.

### 4. Web UI

- deaktivierte Navigationseinträge ausblenden
- Deep Links abfangen
- Prediction Copier sichtbar und erreichbar halten
- klar zwischen Prediction Copier und sonstigen Bots unterscheiden
- optional für Admins „Disabled in limited beta“ anzeigen

### 5. Admin UI

Admins dürfen Feature- und Runtime-Status sehen. Der Prediction Copier benötigt einen klaren Runtime-Status, globalen Kill Switch und aktive Nutzerzahl.

### 6. Bestehende Payment-Lösung

Keine Änderung an Wallet- oder Payment-Architektur. Nur prüfen, dass Feature-Gating diese Flows nicht versehentlich blockiert.

### 7. Dokumentation

Erstelle `docs/limited-beta-mode.md` mit Feature-Matrix, Jobs, Environment-Variablen und Rollback-Hinweisen.

## Tests

- Unit Tests der Feature Registry
- deaktivierte Grid- und Vault-Routen
- Prediction Copier bleibt erreichbar
- Prediction Copier Job wird registriert
- deaktivierte Jobs starten nicht
- Navigation und Deep Link Guards
- bestehende Wallet-/Payment-Smoke-Tests bleiben grün

## Akzeptanzkriterien

- Grid und Vaults sind technisch nicht nutzbar.
- Prediction Copier ist für berechtigte Nutzer verfügbar.
- Keine deaktivierte Runtime startet.
- Manual Trading, Paper Trading und AI Predictions bleiben nutzbar.
- Bestehende Payment-Flows funktionieren unverändert.
