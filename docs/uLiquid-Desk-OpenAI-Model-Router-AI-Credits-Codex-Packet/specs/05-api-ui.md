# 05 – API und UI

## API

### Billing Summary

`GET /billing/ai-credits`

Liefert:

- verfügbares Guthaben
- reserviertes Guthaben
- Lifetime-Verbrauch
- tägliches/monatliches Limit und Verbrauch
- aktive Warnstufe
- Top-up-Pakete

### Estimate

`POST /ai/runs/estimate`

Input: Scope, Profil, Skills, Symbole, Konten, erwartete Aktion.

Output:

- geschätzte Credit-Spanne
- gewählte Modellklasse, nicht zwingend konkreter Modellname
- maximale Reservierung
- Bestätigung erforderlich

Schätzung ist unverbindlich, aber Server-Hardcap darf nicht überschritten werden.

### Agent Run

`POST /ai/agent/runs`

- idempotency key erforderlich
- reserviert Credits
- startet Run
- streamt Antwort und Activity Events
- settled automatisch

### Usage History

`GET /billing/ai-credits/usage`

Zeigt aggregierte Runs, keine sensiblen Promptdaten.

## UI

### Agent Chat Header

- AI Credits verfügbar
- geschätzte Kosten vor teuren Deep-Workflows
- aktuelle Analyseklasse: Standard / Erweitert / Tiefenanalyse
- kein Provider- oder Modellpicker

### Nach einem Run

- verbrauchte Credits
- Restguthaben
- verwendete Skill-Kategorien
- bei Bedarf Detailansicht mit Modellklasse und Tokenkategorien

### Billing-Seite

- Guthaben
- reserviert
- Verbrauch heute/Monat
- Top-up kaufen
- Usage History
- Limits konfigurieren

### Warnungen

- 20 % Restguthaben
- 10 % Restguthaben
- unzureichendes Guthaben
- Tages-/Monatslimit erreicht
- Deep Analysis benötigt höhere Reservierung

## Fehlercodes

- `ai_credit_balance_exhausted`
- `ai_credit_reservation_failed`
- `ai_daily_limit_exceeded`
- `ai_monthly_limit_exceeded`
- `ai_run_limit_exceeded`
- `ai_pricing_unavailable`
- `ai_model_unavailable`
- `ai_usage_settlement_failed`
