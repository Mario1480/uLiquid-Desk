# uLiquid Desk – FMP Replacement & AI Market Intelligence

## Ziel

FMP als fest verdrahtete Quelle für Wirtschaftskalender und News kontrolliert ablösen. Die Plattform erhält eine providerunabhängige Datenarchitektur, die zunächst möglichst kostenlose und offiziell nutzbare Quellen kombiniert.

Dieses Paket ist für mehrere Codex-Agenten gedacht. Die Umsetzung soll schrittweise erfolgen, sodass bestehende Kalender-, News-, Prediction- und Telegram-Funktionen während der Migration funktionsfähig bleiben.

## Nicht Bestandteil

- Payment- oder Billing-Implementierung
- CCPayment-Migration
- Trading-Ausführung
- Grid- oder Vault-Funktionen
- autonome AI-Handelsentscheidungen

## Ausgangslage vor der Umsetzung

FMP war vor der Umsetzung unter anderem verankert in:

- `apps/api/src/services/economicCalendar/providers/fmp.ts`
- `apps/api/src/services/economicCalendar/index.ts`
- `apps/api/src/services/economicCalendar/types.ts`
- `apps/api/src/services/news/providers/fmp.ts`
- `apps/api/src/services/news/index.ts`
- `apps/api/src/services/news/types.ts`
- `apps/api/src/routes/economic-calendar.ts`
- `apps/api/src/admin/externalHealth.ts`
- `apps/api/src/admin/routes-api-keys.ts`
- `apps/web/app/news/page.tsx`
- `apps/web/app/admin/api-keys/page.tsx`
- Prisma-Defaults und Migrationen mit `provider/source = fmp`
- Telegram- und System-Health-Jobs
- Übersetzungen und Tests

## Umsetzungsstand – 2026-08-02

Die lokale Implementierung der acht Arbeitspakete ist abgeschlossen. Das ist
noch keine automatische Produktionsfreigabe: Migration, VPS-Smokes und die
zeitabhängigen Rollout-Gates bleiben separat nachzuweisen.

- [x] **1 – Provider Contracts und Migration:** Provider-neutrale Verträge,
  Registry, Prioritäten, strukturierte Degraded-Ergebnisse, Prisma-Schema und
  rückwärtskompatible Migration sind implementiert.
- [x] **2 – RSS-News-Aggregation:** Freigegebene Fed-, ECB- und SEC-Feeds,
  gemeinsamer RSS-/Atom-Adapter, Normalisierung, Deduplizierung, Sanitizing,
  SSRF-Schutz und Source-Isolation sind implementiert.
- [x] **3 – Offizieller Wirtschaftskalender:** Alle MVP-Events werden über
  BLS/Eurostat oder explizit kuratierte FOMC-, ECB-, BEA-, Census- und
  DOL-Schedules erzeugt. UTC, DST, stabile Event-Identitäten, BLS-Ausfallpfad
  und getrennte Revisionen sind berücksichtigt. Seit der Nachbesserung vom
  13.08.2026 werden außerdem alle offiziellen Eurostat-Euroindikatoren als
  High/Medium/Low übernommen; Kalender-Defaults und alte Präferenzen öffnen
  USA und Eurozone mit allen Relevanzstufen.
- [x] **4 – Data Service, Cache und API:** Interner Service, Postgres-Persistenz,
  Stale-Cache, Circuit Breaker, Refresh-Job und kompatible News-/Kalenderrouten
  sind implementiert.
- [x] **5 – AI Summary und Risk Context:** Quellengebundene, schema-validierte
  Summary, Citation-Prüfung, versionierter Cache und begrenzter Prediction-
  Kontext ohne Trading-Tools sind implementiert.
- [x] **6 – Market-Intelligence-UI:** Dashboard-Summary, Market-Intelligence-
  Seite, Quellenlinks, Fakten-/Inferenz-Kennzeichnung, Unsicherheiten sowie
  Degraded-/Stale-Darstellung sind responsiv umgesetzt.
- [x] **7 – Admin, Health und Observability:** Provider-Admin, getrennte
  Zustände, Enable/Disable, Lizenz-Gates, Audit-Trail, External Health und
  gruppierte Telegram-Zustände sind implementiert.
- [x] **8 – Tests, Dokumentation und lokaler Rollout-Unterbau:** Unit-,
  Integrations-, Contract- und Degraded-Tests, Feature Flags, Betriebsdoku,
  Release-Evidence und Rollback-Pfad sind umgesetzt.

### Vor beziehungsweise nach dem VPS-Deploy noch offen

- [ ] Zielsystem sichern und die Migration
  `prisma/migrations/20260802170000_market_intelligence_providers/migration.sql`
  im normalen Deploy-Prozess anwenden und verifizieren.
- [ ] Produktionsvariablen prüfen: neue Provider aktiv, AI Summary bewusst
  konfigurieren und `FMP_LEGACY_ENABLED=false` sowie
  `FMP_LEGACY_FALLBACK_ENABLED=false` setzen, sofern kein geplanter
  Rollback-Test läuft.
- [ ] Post-Deploy-Smokes für Dashboard, News, Kalender, Market Intelligence,
  Admin Providers, Telegram Daily Calendar und Prediction Context durchführen.
- [ ] Provider-Abdeckung, Latenz, Stale-/Degraded-Zustände und Alerts im Betrieb
  beobachten und als Release-Evidence dokumentieren.
- [ ] Mindestens sieben stabile Betriebstage ohne FMP nachweisen.
- [ ] Erst danach Phase 5 abschließen: Legacy-FMP-Adapter, FMP-Key-Adminbereich
  und FMP-Health-Probe entfernen und die betroffenen Tests/Dokumente bereinigen.

## Zielarchitektur

```text
Official Sources / RSS / Optional APIs / Exchanges
                    │
                    ▼
          Provider Adapter Layer
                    │
                    ▼
       Normalization + Deduplication
                    │
          ┌─────────┴─────────┐
          ▼                   ▼
        Cache              Database
          │                   │
          └─────────┬─────────┘
                    ▼
          Internal Data Service
     /news /economic-calendar /summary
                    │
          ┌─────────┴─────────┐
          ▼                   ▼
      uLiquid UI       AI Prediction Context
```

## Empfohlene kostenlose Startquellen

### Crypto-News

1. RSS-/Atom-Feeds ausgewählter Publisher
2. offizielle Projekt-, Börsen- und Regulierungsfeeds
3. optional Marketaux als ergänzender API-Provider, falls dessen aktueller Tarif und Lizenz zur Nutzung passen

### Wirtschaftsdaten

1. Offizielle Quellen als primäre Quelle
2. kuratierte Event-Definitionen für die wichtigsten marktbewegenden Veröffentlichungen
3. optional kostenpflichtiger Provider später als Fallback

Mögliche offizielle Quellen:

- Federal Reserve / FOMC
- U.S. Bureau of Labor Statistics
- U.S. Bureau of Economic Analysis
- U.S. Census Bureau
- European Central Bank
- Eurostat
- Bank of England
- Bank of Japan
- Statistics Canada
- weitere nationale Statistikämter nach Bedarf

### Marktdaten

Weiter direkt von unterstützten Börsen beziehen:

- Hyperliquid
- Binance als öffentlicher Referenzfeed, sofern im Projekt vorgesehen
- Bitget
- MEXC beziehungsweise weitere vorhandene Adapter

## Arbeitspakete

| Reihenfolge | Status | Datei | Aufgabe |
|---|---|---|---|
| 1 | Erledigt | `01-provider-contracts-and-migration.md` | Provider-Abstraktion und Migrationsbasis |
| 2 | Erledigt | `02-news-rss-aggregation.md` | RSS-News, Normalisierung und Deduplizierung |
| 3 | Erledigt | `03-economic-calendar-official-sources.md` | eigener Wirtschaftskalender-Aggregator |
| 4 | Erledigt | `04-data-service-cache-and-api.md` | interner Data Service, Cache und API |
| 5 | Erledigt | `05-ai-news-summary-and-risk-context.md` | AI-Zusammenfassungen und Prediction-Kontext |
| 6 | Erledigt | `06-market-intelligence-ui-future.md` | Market-Summary-UX |
| 7 | Erledigt | `07-admin-health-observability.md` | Provider-Admin, Health und Monitoring |
| 8 | Lokal erledigt; Betriebsabnahme offen | `08-testing-rollout-and-acceptance.md` | Tests, Migration und Rollout |

## Verbindliche Prinzipien

1. Keine externe Quelle darf direkt aus React-Komponenten aufgerufen werden.
2. API-Schlüssel bleiben ausschließlich serverseitig.
3. Jeder Datensatz muss Quelle, Abrufzeit und möglichst Original-URL enthalten.
4. Originaltexte dürfen nicht ungeprüft vollständig gespeichert oder erneut veröffentlicht werden.
5. AI-Zusammenfassungen müssen auf gespeicherten Quellenreferenzen beruhen.
6. Providerfehler dürfen Prediction- oder Dashboard-Endpunkte nicht vollständig abstürzen lassen.
7. Bei unvollständigen Daten wird `degraded` statt falscher Vollständigkeit gemeldet.
8. AI darf aus News und Kalenderdaten Hinweise erzeugen, aber niemals Trades ausführen.
9. Lizenz- und Nutzungsbedingungen jeder produktiv aktivierten Quelle sind vor Aktivierung manuell zu prüfen und zu dokumentieren.
10. FMP erst entfernen, wenn alle Verbraucher auf die neuen internen Contracts migriert und getestet sind.

## Definition of Done

- [x] FMP ist kein erforderlicher Runtime-Provider mehr.
- [x] News und Kalender funktionieren ohne FMP-Key.
- [x] Alle aktiven Verbraucher nutzen providerneutrale Typen.
- [x] Der Admin kann Providerzustände sehen und einzelne Quellen deaktivieren.
- [x] AI Predictions erhalten normalisierten News- und Event-Kontext.
- [x] Die Plattform kann eine priorisierte AI Market Summary erzeugen.
- [x] Alle zentralen Pfade besitzen Unit-, Integration- und Degraded-Mode-Tests.
- [ ] Produktionsmigration und Post-Deploy-Smokes sind auf dem VPS belegt.
- [ ] Sieben stabile FMP-off-Tage und der anschließende Phase-5-Cleanup sind
  abgeschlossen.
