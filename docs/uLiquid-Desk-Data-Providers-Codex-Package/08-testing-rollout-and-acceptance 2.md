# Agent 8 – Tests, Rollout und Abnahme

## Auftrag

Definiere und implementiere einen sicheren Rollout von FMP zu providerneutralen News- und Kalenderdiensten.

## Testebenen

### Unit Tests

- Provider Contracts
- RSS/Atom Parser
- URL Sanitizing
- SSRF-Schutz
- Deduplizierung
- Symbol-/Kategorie-Mapping
- Event-Zeitzonen
- Event Revisionen
- Summary Schema
- Source Citation Validation
- Cache Keys
- Provider Registry

### Integration Tests

- mehrere Newsprovider, einer fällt aus
- Kalender-Schedule und Release Merge
- Datenbank Upsert ohne Duplikate
- bestehende `/news`-Route
- bestehende `/economic-calendar`-Route
- Telegram Daily Calendar
- Prediction News Risk
- Admin Health

### Contract Tests

Fixtures verwenden, nicht dauerhaft Live-Provider in CI aufrufen.

Für jede Source eine gespeicherte, bereinigte Fixture mit Herkunft und Abrufdatum.

### E2E Smoke

- Dashboard News
- Kalenderseite
- Newsseite
- AI Prediction mit News Context
- Market Summary
- Source Explorer
- Degraded Banner

## Rollout-Phasen

### Phase 1 – Shadow Mode

- neue Provider laden Daten parallel
- UI verwendet weiterhin bisherigen Pfad
- Datenqualität und Abdeckung vergleichen
- keine Nutzerwirkung

### Phase 2 – Internal Beta

- Admin und interne Accounts nutzen neue Quellen
- FMP bleibt Fallback
- Metriken vergleichen

### Phase 3 – Limited Beta

- neue Provider primär
- FMP nur über Feature Flag als Fallback
- Market Summary eingeschränkt aktivieren

### Phase 4 – FMP Off

- `FMP_LEGACY_ENABLED=false`
- mindestens sieben Tage stabiler Betrieb
- keine kritische Consumer-Abhängigkeit

### Phase 5 – Cleanup

- FMP Admin UI entfernen
- FMP Health Check entfernen
- Legacy Adapter archivieren oder löschen
- Übersetzungen, Tests und Dokumentation bereinigen

## Feature Flags

```env
MARKET_INTELLIGENCE_ENABLED=true
RSS_NEWS_ENABLED=true
OFFICIAL_ECONOMIC_CALENDAR_ENABLED=true
AI_MARKET_SUMMARY_ENABLED=false
FMP_LEGACY_ENABLED=true
FMP_LEGACY_FALLBACK_ENABLED=true
```

## Qualitätskriterien

### News

- keine ungefilterten Duplikate
- Publisher und Original-Link vorhanden
- Datenalter sichtbar
- einzelne Source-Ausfälle toleriert

### Kalender

- nächste High-Impact-Events korrekt in UTC
- keine erfundenen Forecasts
- Verschiebungen und Revisionen korrekt
- Source Link oder Source Name vorhanden

### AI

- Summary enthält Citations
- Fakten und Inferenz getrennt
- keine Trade-Ausführung
- Degraded Data wird erwähnt

## Rollback

- Registry auf Legacy-FMP zurückschalten
- Datenbankschema bleibt rückwärtskompatibel
- alte API-Response-Formate bleiben in der Migration stabil
- kein Rollback erfordert Datenlöschung

## Finale Abnahmecheckliste

- [ ] News funktionieren ohne FMP-Key
- [ ] Kalender funktioniert ohne FMP-Key
- [ ] Telegram Daily Calendar funktioniert
- [ ] Prediction News Risk funktioniert
- [ ] Dashboard zeigt Providerstatus
- [ ] AI Summary besitzt Quellen
- [ ] Source Terms Status aller aktiven Quellen ist `approved`
- [ ] keine Secrets im Client oder Logs
- [ ] Degraded Mode getestet
- [ ] Stale Cache getestet
- [ ] FMP kann per Flag vollständig deaktiviert werden
- [ ] Dokumentation und `.env.example` aktualisiert
- [ ] Migration in Staging erfolgreich
