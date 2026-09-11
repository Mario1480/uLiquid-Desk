# Agent 08 – Quality, Testing and Observability

## Auftrag

Erstelle eine belastbare Qualitäts- und Beobachtbarkeitsbasis für die Limited Beta mit AI Predictions, Prediction Copier, Position Copilot, Exchange-Degradation und Feature-Gating.

## Unit Tests

- Feature Registry
- Prediction Schemas
- Preislevel-Plausibilität
- Template-Draft-Validierung
- Copier Eligibility
- Copier Risk Gates
- Idempotency Keys
- Position-Risk-Trigger
- Tool Allowlisting
- Rate Limits

## Integration Tests

- Prediction Generation und Preview
- Prediction Evaluation
- Copier Pipeline von Prediction bis Execution Record
- Order Engine Integration
- unbekannter Orderstatus
- Position Snapshot und Copilot Pipeline
- Telegram Deduplizierung
- deaktivierte Feature Routes
- teilweise fehlerhafte Exchange-Verbindungen

## End-to-End Smoke Tests

- Login
- Dashboard
- Spot-/Perp-Positionen
- Paper Trade
- manuelle Live-Order im Testkonto
- AI Prediction erstellen
- Template im Chat erstellen
- Preview
- Copier-Regel erstellen und aktivieren
- geeignete Prediction genau einmal kopieren
- Copier pausieren
- Position Copilot anzeigen
- Grid/Vault Deep Link blockiert
- bestehender Wallet-/Payment-Checkout-Smoke-Test

## Metriken

- Prediction Requests und Success Rate
- Schema Retry Rate
- Provider Error Rate
- Token Usage
- Copier Evaluations
- Copier Eligible/Skipped/Executed
- Skip Reasons
- Copier Order Success Rate
- Duplicate Prevention Count
- Copier Pauses und Kill-Switch-Aktivierungen
- Exposure und PnL nach Regel
- Position Copilot Runs
- Exchange Degraded Rate

## Alerts

- AI Provider nicht erreichbar
- hohe Schemafehler
- stark erhöhte Tokenkosten
- Prediction Evaluator hängt
- Copier Duplicate-Versuch
- unbekannter Orderstatus
- auffällig hohe Copier-Fehlerrate
- Risk Limit überschritten
- Exchange-Daten degraded
- Notification Spam

## Health Endpoints

- AI Provider
- Prediction Evaluator
- Prediction Copier Runtime
- Position Copilot Scheduler
- Exchange Aggregation
- Feature Mode

Keine vertraulichen Details öffentlich ausgeben.

## Dokumentation

- `docs/limited-beta-test-plan.md`
- `docs/ai-observability.md`
- `docs/prediction-copier-operations.md`
- `docs/manual-beta-smoke-test.md`

## Akzeptanzkriterien

- kritische Beta-Flows sind getestet
- Copier ist vollständig beobachtbar
- Doppelorders und unbekannte Orderzustände sind abgesichert
- AI-, Exchange- und Runtime-Ausfälle sind sichtbar
- bestehende Payment-Lösung bleibt funktionsfähig
