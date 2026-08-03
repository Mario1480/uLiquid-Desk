# Agent 5 – AI News Summary und Risk Context

## Auftrag

Nutze normalisierte News- und Kalenderdaten für kurze, belegte AI-Zusammenfassungen und als zusätzlichen Kontext für Predictions. AI bleibt strikt read-only und darf keine Orders oder Bot-Aktionen ausführen.

## Summary-Typen

### Daily Market Brief

- wichtigste Makrotermine
- wichtigste Crypto-News
- regulatorische und Security-Ereignisse
- Funding-/Marktstrukturhinweise aus bestehenden Datenquellen
- klare Unsicherheiten und fehlende Quellen

### Symbol Brief

Beispiel BTC:

- relevante BTC-News der letzten 24 Stunden
- Makroereignisse im gewählten Horizont
- potenzielle positive/negative Katalysatoren
- keine Trading-Anweisung

### Event Brief

- was wird veröffentlicht
- warum ist es relevant
- Actual/Forecast/Previous, sofern legal verfügbar
- beobachtete unmittelbare Marktreaktion

## Grounding

Jede Summary benötigt:

```ts
export type SummaryCitation = {
  newsItemId?: string;
  economicEventId?: string;
  sourceName: string;
  sourceUrl?: string;
  publishedAt?: string;
};
```

Die UI muss Quellen öffnen können. Keine Summary darf als erfolgreich gelten, wenn keine Source IDs zurückgegeben werden.

## AI-Ausgabeschema

```ts
export type MarketSummary = {
  title: string;
  generatedAt: string;
  horizon: "intraday" | "24h" | "7d";
  overallRisk: "low" | "moderate" | "high" | "unknown";
  sentiment: "bearish" | "neutral" | "bullish" | "mixed";
  highlights: Array<{
    type: "macro" | "crypto" | "regulation" | "security" | "market";
    importance: "low" | "medium" | "high";
    headline: string;
    explanation: string;
    sourceIds: string[];
  }>;
  upcomingRisks: Array<{
    label: string;
    scheduledAt?: string;
    sourceIds: string[];
  }>;
  uncertainties: string[];
};
```

## Prediction Integration

Der Prediction Prompt erhält nur kompakten, strukturierten Kontext:

- Top relevante News Cluster
- bevorstehende High-Impact-Events
- Datenalter
- Providerstatus
- Summary-Unsicherheiten

Regeln:

- News dürfen technische Analyse ergänzen, nicht ersetzen.
- Fehlende oder gestörte Quellen senken die Vertrauenswürdigkeit.
- Kein News-Kontext darf automatisch eine Order auslösen.
- `no_trade` muss bei außergewöhnlicher Unsicherheit möglich sein.
- Prompt und Schema müssen explizit zwischen Fakten und AI-Inferenz unterscheiden.

## Kostenkontrolle

- Deduplizierte Cluster statt jeden Artikel einzeln an das Modell senden
- kleine Vorverarbeitung lokal/regelorientiert
- Cache nach Cluster-Hash
- Tokenbudget pro Summary
- Modell konfigurierbar
- asynchrone Generierung

## Akzeptanzkriterien

- Jede AI-Aussage ist mindestens einem Source-Datensatz zugeordnet oder als Inferenz markiert.
- AI-Ausgaben werden schema-validiert.
- Zusammenfassungen werden gecacht und versioniert.
- Provider-Degraded-Status erscheint in der Summary.
- Prediction-Tests prüfen Verhalten bei fehlenden, widersprüchlichen und veralteten News.
- Es existiert kein ausführbares Trading-Tool im Agent Toolset.
