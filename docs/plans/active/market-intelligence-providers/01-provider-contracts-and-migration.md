# Agent 1 – Provider Contracts und sichere FMP-Migration

## Auftrag

Entkopple News und Wirtschaftskalender von FMP. Implementiere providerneutrale Contracts, ohne FMP sofort zu löschen. FMP bleibt zunächst optionaler Legacy-Adapter, bis der Rollout abgeschlossen ist.

## Zielstruktur

```text
apps/api/src/services/marketIntelligence/
  contracts/
    news.ts
    economicCalendar.ts
    provider.ts
    health.ts
  providers/
    legacyFmp/
  normalization/
  registry/
```

Die bestehende Ordnerstruktur darf alternativ beibehalten werden, solange die Contracts domänenneutral sind.

## Providerneutrale Typen

### NewsItem

```ts
export type NewsItem = {
  id: string;
  provider: string;
  sourceName: string;
  sourceUrl: string;
  canonicalUrl?: string;
  title: string;
  summary?: string;
  publishedAt: string;
  fetchedAt: string;
  language?: string;
  symbols: string[];
  categories: string[];
  sentiment?: {
    score: number;
    label: "negative" | "neutral" | "positive";
    origin: "provider" | "local_model" | "ai";
  };
  contentHash: string;
};
```

### EconomicEvent

```ts
export type EconomicEvent = {
  id: string;
  provider: string;
  sourceName: string;
  sourceUrl?: string;
  country: string;
  currency?: string;
  category: string;
  title: string;
  scheduledAt: string;
  importance: "low" | "medium" | "high";
  status: "scheduled" | "released" | "revised" | "cancelled";
  actual?: string | number;
  forecast?: string | number;
  previous?: string | number;
  unit?: string;
  period?: string;
  fetchedAt: string;
};
```

## Provider Contracts

```ts
export interface NewsProvider {
  readonly id: string;
  fetchNews(input: FetchNewsInput): Promise<ProviderResult<NewsItem[]>>;
  health(): Promise<ProviderHealth>;
}

export interface EconomicCalendarProvider {
  readonly id: string;
  fetchEvents(input: FetchEconomicEventsInput): Promise<ProviderResult<EconomicEvent[]>>;
  health(): Promise<ProviderHealth>;
}
```

`ProviderResult` muss Daten, Warnungen, Latenz, Abrufzeit und Degraded-Status enthalten.

## Registry

Erstelle eine Registry, die Provider anhand von Konfiguration aktiviert:

```env
NEWS_PROVIDERS=rss,marketaux
ECONOMIC_CALENDAR_PROVIDERS=official
FMP_LEGACY_ENABLED=false
```

Keine Route darf auf `z.literal("fmp")` beschränkt bleiben.

## Datenbankmigration

- Keine alten Migrationen nachträglich verändern.
- Prisma-Defaults von `fmp` auf einen neutralen Wert wie `unknown` oder `official` umstellen.
- Provider als freies, validiertes `String`-Feld erhalten.
- Bestehende FMP-Datensätze müssen lesbar bleiben.
- Neue Felder für `sourceUrl`, `fetchedAt`, `contentHash`, `canonicalUrl` und Lizenzmetadaten prüfen.

## Bestehende Verbraucher migrieren

Mindestens:

- Kalenderroute
- News-Service
- News-Seite
- Dashboard
- News-Risk-Blocking
- Telegram Daily Economic Calendar
- AI Prediction Context
- externe Health Checks
- Admin API Keys

## Rückwärtskompatibilität

Während der Übergangsphase dürfen öffentliche Responses ihre bisherigen Felder behalten. Intern muss jedoch bereits das neue Modell verwendet werden.

## Akzeptanzkriterien

- Keine Domain-Typen enthalten mehr `source: "fmp"` als Literal.
- Provider können über Registry hinzugefügt werden, ohne Routes zu ändern.
- FMP kann per Konfiguration ausgeschaltet werden.
- Bestehende FMP-Daten bleiben darstellbar.
- Ein Providerfehler führt zu einem strukturierten Degraded-Ergebnis.
- Unit-Tests decken Registry, Provider-Priorität und Fallback ab.
