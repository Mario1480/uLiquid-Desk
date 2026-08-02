# Agent 02 – AI Predictions UI/UX Redesign

## Auftrag

Überarbeite die AI-Predictions-Oberfläche zu einem klaren, vertrauenswürdigen und mobilen Workflow. Bestehende Funktionalität sowie die Verbindung zum Prediction Copier bleiben erhalten.

## Zielstruktur

Tabs oder gleichwertige Navigation:

1. `Overview`
2. `Active`
3. `History`
4. `Performance`

Primäre CTAs:

- `New Analysis`
- bei geeigneten abgeschlossenen oder aktiven Predictions: `Use in Prediction Copier`

Der Copier-CTA darf keine sofortige Aktivierung auslösen. Er öffnet ausschließlich einen vorkonfigurierten Review-Flow.

## Anforderungen

### Overview

- aktive Predictions
- heutige Analysen
- durchschnittliche Confidence
- Trefferquote
- AI-Verbrauch
- Datenquellen-Status
- bis zu fünf aktuelle Predictions
- Copier-Status und Anzahl aktiver Copier-Regeln, falls verfügbar

### Active Predictions

Zeige Symbol, Marktart, Timeframe, Horizont, Richtung, Confidence, Entry Zone, Stop, Targets, aktuellen Preis, Zwischenstatus und letzte Aktualisierung.

Trenne:

- Prediction Direction
- Current Outcome
- Final Evaluation

### History

Filter nach Symbol, Markt, Timeframe, Prompt, Provider und Ergebnis. Zeige zusätzlich, ob eine Prediction vom Copier berücksichtigt oder ausgeführt wurde.

### Performance

- Direction Accuracy
- Target Hit Rate
- Stop Hit Rate
- MFE und MAE
- Confidence Buckets
- Symbol
- Timeframe
- Prompt Template
- Provider/Modell
- optional Copier-Ausführungsergebnis getrennt von Prediction-Qualität

Prediction-Qualität und Trading-Ergebnis des Copiers dürfen nicht als dieselbe Kennzahl dargestellt werden.

### Prediction Detail

1. Executive Summary
2. Direction und Confidence
3. Entry Zone, Stop/Invalidation und Targets
4. Risk/Reward
5. Key Drivers
6. Invalidations
7. Risk and uncertainty
8. Datenquellen und Zeitpunkt
9. bisheriger Verlauf
10. Copier Eligibility und Nutzungshistorie
11. Nutzeraktionen

Erlaubte Aktionen:

- `Open in Trading Desk`
- `Create similar analysis`
- `Monitor market`
- `Save as template`
- `Configure Prediction Copier`

Nicht zulässig:

- direkte, ungeprüfte Orderausführung aus der Prediction-Ansicht

### New Analysis Wizard

Schritte:

1. Market
2. Analysis Type
3. Advanced Settings
4. Review
5. Generate

Trenne Candle-Timeframe und Analysehorizont. Nutze verständliche Signalmodi:

- Rules only
- AI only
- Rules validated by AI

### Komponentenstruktur

Zielrichtung:

```text
apps/web/components/predictions/
  PredictionsOverview.tsx
  ActivePredictions.tsx
  PredictionHistory.tsx
  PredictionPerformance.tsx
  PredictionDetailDrawer.tsx
  PredictionCreateWizard.tsx
  PredictionCopierEligibility.tsx
```

## Tests

- Wizard-Validierung
- laufende Prediction wird nicht final bewertet
- Copier-CTA öffnet nur Review-Flow
- Prediction- und Copier-Metriken bleiben getrennt
- Degraded State
- i18n Deutsch/Englisch
- mobile Smoke-Tests

## Akzeptanzkriterien

- Prediction UI ist modular und verständlich.
- Copier ist sinnvoll integriert, ohne Sofortausführung.
- Unsicherheit, Invalidierung und Datenqualität sind sichtbar.
- Bestehende Prediction-Historie bleibt verfügbar.
