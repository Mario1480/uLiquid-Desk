# Agent 4 – Interner Market Data Service, Cache und API

## Auftrag

Führe News, Wirtschaftskalender und später weitere Marktinformationen hinter einer einheitlichen internen Service-Schicht zusammen. Es ist nicht zwingend ein separates Deployment erforderlich; zunächst kann es ein klar abgegrenztes Modul in `apps/api` sein.

## Interne Services

```ts
interface MarketIntelligenceService {
  getNews(input: GetNewsInput): Promise<NewsResult>;
  getEconomicEvents(input: GetEconomicEventsInput): Promise<EconomicEventResult>;
  getMarketContext(input: GetMarketContextInput): Promise<MarketContext>;
  getDailySummary(input: GetDailySummaryInput): Promise<MarketSummary>;
}
```

## Cache-Strategie

### News

- Feed Fetch Cache: 5–15 Minuten je Quelle
- normalisierte Einträge persistent speichern
- API Query Cache: 30–120 Sekunden

### Economic Calendar

- Termine der nächsten 30 Tage persistent
- heutige Events häufiger aktualisieren
- historische Releases unveränderlich, Revisionen als Update/History

### AI Summaries

- nach `sourceClusterHash + promptVersion + model` cachen
- keine erneute Generierung bei identischen Quellen
- TTL abhängig vom Summary-Typ

## API-Endpunkte

```text
GET /news
GET /news/:id
GET /economic-calendar
GET /economic-calendar/next
GET /market-intelligence/context
GET /market-intelligence/summary
```

Die bestehenden Routen können erhalten bleiben und intern delegieren.

## Response Metadaten

Jede aggregierte Response enthält:

```ts
{
  data: ...,
  meta: {
    generatedAt: string;
    providerStates: ProviderState[];
    degraded: boolean;
    warnings: string[];
    nextRefreshAt?: string;
  }
}
```

## Rate Limits und Lastschutz

- externe Provider nur über Jobs/Cache abfragen
- Nutzeranfragen dürfen keinen unkontrollierten Provider-Fan-out auslösen
- Circuit Breaker je Provider
- Retry mit Jitter
- begrenzte Parallelität
- Stale-While-Revalidate

## Datenaufbewahrung

- News-Metadaten nach konfigurierbarer Frist löschen oder archivieren
- Quellenlinks behalten, solange Summary referenziert wird
- Provider-Rohantworten standardmäßig nicht dauerhaft speichern
- Debug-Rohdaten nur kurzzeitig und ohne Secrets

## Akzeptanzkriterien

- UI und AI konsumieren ausschließlich interne Endpunkte.
- Provider-Ausfälle werden in Metadaten sichtbar.
- Stale Cache kann bei temporären Ausfällen genutzt werden.
- Nutzertraffic löst keine lineare Anzahl externer Requests aus.
- Cache-Key- und Invalidierungslogik ist getestet.
- Bestehende Kalender- und News-Routen bleiben kompatibel.
