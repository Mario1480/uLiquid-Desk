# Agent 02 – Börsenübergreifende Read Skills

## Auftrag

Ersetze das Binance-Hardcoding der AI-Market-Tools durch eine interne, normalisierte Skill- und Provider-Schicht. Bestehende Exchange-Pakete wiederverwenden.

## Architektur

```text
AI Skill Registry
  → Market Data Service
    → Venue Resolver
      → Spot: packages/exchange / CCXT
      → Perp: provider wrappers over existing futures market clients
  → Normalized Result + Source Metadata
```

## Empfohlene neue Paketgrenze

```text
packages/market-data/
  src/contracts/
  src/registry/
  src/providers/
  src/normalization/
  src/index.ts
```

Das Paket darf `@mm/exchange` und `@mm/futures-exchange` verwenden. Es darf nicht von diesen Paketen zurückimportiert werden.

Alternativ ist ein API-lokales Modul zulässig, wenn Codex nach Prüfung eine neue Package-Grenze für unverhältnismäßig hält. Entscheidung dokumentieren.

## Standardvertrag

```ts
type MarketDataVenue =
  | "auto"
  | "binance"
  | "bitget"
  | "hyperliquid"
  | "mexc"
  | "bingx";

type MarketDataSourceMeta = {
  requestedVenue: MarketDataVenue;
  sourceVenue: Exclude<MarketDataVenue, "auto">;
  marketType: "spot" | "perp";
  symbol: string;
  observedAt: string;
  fetchedAt: string;
  stale: boolean;
  degraded: boolean;
  fallbackUsed: boolean;
  fallbackReason?: string;
};
```

Jede Antwort liefert `data` und `meta`.

## Skills im MVP

### Market

- `market.get_ohlcv`
- `market.get_indicators`
- `market.get_ticker`
- `market.get_orderbook`
- `market.get_funding_rate`
- `market.get_open_interest`
- `market.get_contract_info`

### Intelligence

- `intelligence.get_news`
- `intelligence.get_economic_events`

### Predictions

- `predictions.get_recent`
- `predictions.get_performance_summary`

### Portfolio – nur Account-Read-Profile

- `portfolio.get_positions`
- `portfolio.get_balance_summary`
- `portfolio.get_open_orders`

### Risk – deterministisch

- `risk.analyze_position_snapshot`

## Skill Descriptor

Jeder Skill definiert serverseitig:

```ts
type AgentSkillDescriptor = {
  id: string;
  version: number;
  category: "market" | "intelligence" | "prediction" | "portfolio" | "risk" | "draft";
  accessLevel: "public_data" | "account_read" | "draft_actions";
  sideEffect: false;
  maxCallsPerRun: number;
  timeoutMs: number;
  cacheTtlMs: number;
  supportedMarketTypes: readonly ("spot" | "perp")[];
  inputSchema: z.ZodTypeAny;
  outputSchema: z.ZodTypeAny;
  execute(context, input): Promise<unknown>;
};
```

## Account Binding

Das Modell darf bei Portfolio-Skills keine freie `userId` oder beliebige `exchangeAccountId` übergeben.

Zulässige Tool-Argumente beispielsweise:

```json
{
  "accountRef": "selected",
  "symbol": "ETH/USDC:PERP"
}
```

Die Runtime löst `selected` aus Conversation Context und prüft Ownership erneut.

## Venue Resolver

Reihenfolge für allgemeine Market Skills:

1. explizite Venue aus UI-Kontext,
2. Venue des ausgewählten Kontos oder der Position,
3. gespeicherte Profilpräferenz,
4. serverseitiger Public-Data-Default,
5. optionaler Fallback nur bei öffentlichen Daten.

Kontobezogene Skills dürfen nie auf eine andere Börse ausweichen.

Bei `paper`:

- Execution Account bleibt Paper.
- Marktdatenquelle wird über vorhandene linked-market-data Policy aufgelöst.
- Resultat nennt Paper-Kontext und tatsächliche Source Venue.

## Provider-Priorität für Perp MVP

1. Hyperliquid
2. Binance
3. Bitget
4. danach BingX und MEXC

Spot über bestehende `packages/exchange`-/CCXT-Infrastruktur.

## Migration bestehender Tool-Namen

Für Kompatibilität darf intern zunächst ein Alias bestehen:

```text
get_ohlcv → market.get_ohlcv
get_indicators → market.get_indicators
get_ticker → market.get_ticker
get_orderbook → market.get_orderbook
```

Neue Agent Chat Scopes verwenden nur die namespaceten IDs. Bestehende Prediction-Flows dürfen schrittweise migriert werden.

## Payload-Grenzen

- OHLCV standardmäßig 200, maximal 1000.
- Orderbook standardmäßig 25–50 Ebenen, harte Obergrenze.
- News maximal 10–20 normalisierte Einträge.
- Economic Events enger Zeitraum und Limit.
- Positionen nur notwendige normalisierte Felder.
- Keine rohen Exchange-Antworten an das Modell.

## Tests

- identische normalisierte Shapes für Binance, Hyperliquid und Bitget,
- Spot/Perp-Symbolnormalisierung,
- Venue `auto`, explizite Venue und Paper-linked Venue,
- Unsupported Capability liefert strukturierten Fehler,
- öffentliche Fallbacks sind sichtbar markiert,
- Account Reads wechseln niemals still die Venue,
- unbekannter Provider und unbekannter Skill fail closed,
- keine Credentials in Tool Resultaten.

## Akzeptanzkriterien

- `apps/api/src/ai/tools/index.ts` ist nicht mehr direkt von Binance-Funktionen abhängig oder nutzt nur noch einen klar gekapselten Legacy-Provider.
- Alle neuen Agent Skills geben Source/Freshness/Degraded-Metadaten zurück.
- Drei Perp-Venues im MVP testbar.
- Bestehende Exchange-Execution bleibt unverändert.
