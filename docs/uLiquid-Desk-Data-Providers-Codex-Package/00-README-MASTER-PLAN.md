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

## Ist-Zustand im Repository

FMP ist aktuell unter anderem verankert in:

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

## Agenten-Aufteilung

| Reihenfolge | Datei | Aufgabe |
|---|---|---|
| 1 | `01-provider-contracts-and-migration.md` | Provider-Abstraktion und Migrationsbasis |
| 2 | `02-news-rss-aggregation.md` | RSS-News, Normalisierung und Deduplizierung |
| 3 | `03-economic-calendar-official-sources.md` | eigener Wirtschaftskalender-Aggregator |
| 4 | `04-data-service-cache-and-api.md` | interner Data Service, Cache und API |
| 5 | `05-ai-news-summary-and-risk-context.md` | AI-Zusammenfassungen und Prediction-Kontext |
| 6 | `06-market-intelligence-ui-future.md` | zukünftige Market-Summary-UX aus Punkt 8 |
| 7 | `07-admin-health-observability.md` | Provider-Admin, Health und Monitoring |
| 8 | `08-testing-rollout-and-acceptance.md` | Tests, Migration und Rollout |

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

- FMP ist kein erforderlicher Runtime-Provider mehr.
- News und Kalender funktionieren ohne FMP-Key.
- Alle Verbraucher nutzen providerneutrale Typen.
- Der Admin kann Providerzustände sehen und einzelne Quellen deaktivieren.
- AI Predictions erhalten normalisierten News- und Event-Kontext.
- Die Plattform kann eine priorisierte AI Market Summary erzeugen.
- Alle zentralen Pfade besitzen Unit-, Integration- und Degraded-Mode-Tests.
