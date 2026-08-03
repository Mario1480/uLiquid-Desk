# 07 – Tests und Rollout

## Feature Flags

- `AI_CREDIT_BILLING_V2`
- `AI_MODEL_ROUTER_V1`
- `AI_RESPONSES_API_AGENT`
- `AI_AGENT_CHAT_ENABLED`
- `AI_DEEP_ANALYSIS_ENABLED`

Da keine Alt-Nutzung besteht, dienen Flags dem sicheren Rollout, nicht Legacy-Kompatibilität.

## Testpflicht

### Unit

- Preisberechnung für jedes Modell
- Cached Input
- Cache Write 1,25x
- Long-context Surcharge >272K
- Rundung auf Credits
- Markup BPS
- Routerregeln
- Kostenschätzung

### Integration

- Reserve → Success → Settle → Release
- Reserve → Provider Error ohne Usage → vollständige Freigabe
- Reserve → Provider Error mit Usage → Teilbelastung
- parallele Runs bei knappem Guthaben
- idempotenter Retry
- Pricing Revision wechselt während eines Runs
- Top-up und sofortiger Run
- Limits pro Tag/Monat/Run

### Contract

- OpenAI Responses-Usage-Felder robust parsen
- unbekannte Usage-Felder ignorieren
- fehlende Usage als Abrechnungsfehler behandeln und zur Reconciliation markieren

### E2E

- Agent Chat Standardanalyse
- Terra-Analyse mit mehreren Skills
- Sol Deep Analysis mit Kostenschätzung und Bestätigung
- Guthaben aufgebraucht
- Usage History
- Top-up via bestehendem Billing

## Rollout

1. Schema und Billing Engine deployen, Agent Chat noch aus.
2. Pricing Seeds und Adminansicht prüfen.
3. Shadow Cost Calculation auf internen Testcalls.
4. Interne Nutzer mit echten Credits.
5. Luna Standard-Agent aktivieren.
6. Terra für ausgewählte Workflows aktivieren.
7. Sol nur für Prediction Builder/Deep Analysis aktivieren.
8. Margen, Kosten und Qualität evaluieren; Routing anhand Evals justieren.

## Definition of Done

- Kein Code belastet rohe Tokens.
- Kein UI spricht von Token Balance.
- Alle OpenAI-Calls sind einem Usage Record zugeordnet.
- Kein kostenpflichtiger Agent Run ohne Reservierung.
- Guthaben kann bei parallelen Calls nicht unter null fallen.
- Preise und Markups sind versioniert.
- Nutzer kann kein Modell/Provider wählen.
- Trading-Sicherheitsgrenzen bleiben unverändert.
