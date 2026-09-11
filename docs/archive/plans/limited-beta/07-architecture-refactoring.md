# Agent 07 – Architecture Refactoring for Maintainability

## Auftrag

Reduziere die größten Wartungsrisiken ohne großflächigen Rewrite. Fokus auf Predictions, Prediction Copier, API-Bootstrap und klare Modulgrenzen.

## Prioritäten

### 1. Predictions Web Page zerlegen

Page nur für Koordination und Layout; getrennte Komponenten, Hooks und View Models.

### 2. Prediction Copier als eigenes Modul

Zielrichtung:

```text
apps/api/src/modules/prediction-copier/
  routes.ts
  service.ts
  eligibility.ts
  risk-gates.ts
  execution.ts
  audit.ts
  schemas.ts
```

Vorhandene Struktur respektieren und nur schrittweise refaktorieren.

### 3. API Bootstrap entlasten

Zuerst herauslösen:

- Feature Registry
- Predictions
- Prediction Copier
- AI
- Position Copilot

### 4. Typisierung verbessern

Riskante `any`-Casts im bearbeiteten Scope durch Prisma-Typen, DTOs und Schemas ersetzen.

### 5. Domänenlogik trennen

- Datenbeschaffung
- Prediction Generation
- Evaluation
- Copier Eligibility
- Risk Gates
- Execution
- Persistenz
- Notifications

### 6. Shared Contracts

Web, API und Runner sollen gemeinsame Prediction- und Copier-DTOs nutzen, soweit die bestehende Paketstruktur dies unterstützt.

### 7. Fehlercodes

- `feature_disabled`
- `prediction_validation_failed`
- `prediction_preview_failed`
- `copier_rule_invalid`
- `copier_prediction_ineligible`
- `copier_risk_limit_reached`
- `copier_execution_unknown`
- `position_data_degraded`
- `ai_provider_unavailable`
- `rate_limit_exceeded`

### 8. Wallet und Payment

Die bestehende eigene Lösung ist außerhalb des Refactoring-Scopes. Keine Änderung an Billing-, Wallet- oder Payment-Modulen.

## Tests

- bestehende Prediction- und Copier-Tests bleiben grün
- Route-Registrierung
- Startup/Shutdown
- keine doppelte Job-Registrierung
- Shared DTOs
- Error Mapping
- bestehende Wallet-/Payment-Tests bleiben grün

## Akzeptanzkriterien

- modularere Predictions UI
- klarer Prediction-Copier-Modulbereich
- weniger Domänenlogik im Bootstrap
- keine Regression in Trading oder Payment
