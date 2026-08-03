# Agent 3 – Eigener Economic-Calendar-Aggregator aus offiziellen Quellen

## Auftrag

Baue einen fokussierten Wirtschaftskalender für die wichtigsten marktbewegenden Events. Ziel ist nicht sofort die Vollständigkeit eines kommerziellen Datenanbieters, sondern eine zuverlässige, transparente Basis für Crypto-Trader.

## MVP-Scope

### USA

- FOMC Zinsentscheid
- FOMC Statement / Pressekonferenz
- CPI / Core CPI
- PPI
- Nonfarm Payrolls
- Unemployment Rate
- Initial Jobless Claims
- GDP
- Retail Sales
- PCE / Core PCE

### Eurozone

- ECB Zinsentscheid
- ECB Pressekonferenz
- Eurozone CPI
- Eurozone GDP

### Spätere Erweiterung

- Bank of England
- Bank of Japan
- Kanada
- Australien
- China, sofern eine zuverlässige offizielle Quelle verfügbar ist

## Architektur

Unterscheide zwei Datenarten:

1. **Schedule Sources** – liefern geplante Termine
2. **Release Sources** – liefern Actual/Previous/Revisions

Ein Provider kann beide Rollen erfüllen, muss es aber nicht.

```ts
interface EconomicScheduleProvider {
  fetchSchedule(range: DateRange): Promise<EconomicEvent[]>;
}

interface EconomicReleaseProvider {
  fetchReleases(range: DateRange): Promise<EconomicRelease[]>;
}
```

## Event Definition Registry

Erstelle eine kuratierte Registry:

```ts
export type EconomicEventDefinition = {
  key: string;
  title: string;
  country: string;
  currency: string;
  category: string;
  defaultImportance: "low" | "medium" | "high";
  officialSource: string;
  scheduleStrategy: string;
  releaseStrategy?: string;
  timezone: string;
};
```

## Zeit und Revisionen

- Intern immer UTC speichern.
- Originalzeitzone und Quelle mitführen.
- Sommerzeit berücksichtigen.
- Verschobene Termine aktualisieren statt doppelt anzulegen.
- Revisionswerte separat speichern.
- Bei unklarer Zeit `timeConfidence` kennzeichnen.

## Forecast-Werte

Offizielle Stellen liefern häufig keinen Marktkonsens. Deshalb:

- `forecast` ist optional.
- Niemals erfundene Forecast-Werte erzeugen.
- Wenn kein lizenzierter Consensus-Provider vorhanden ist, UI klar mit `Not available` darstellen.
- AI darf fehlende Forecasts nicht schätzen und als Marktkonsens ausgeben.

## Impact Rating

Die Importance kann zunächst aus der kuratierten Registry stammen. Später kann sie anhand historischer Volatilität ergänzt werden.

## Jobs

- tägliche Schedule-Synchronisierung für 30–90 Tage
- häufigere Aktualisierung am Veröffentlichungstag
- Release-Abfrage kurz nach geplantem Termin
- Retry mit Backoff
- Reconciliation für verschobene oder revidierte Events

## News Risk Integration

Die vorhandene News-/Event-Blackout-Logik muss weiter funktionieren:

- High Impact Event in X Minuten
- Event aktuell laufend
- Release verspätet oder Daten fehlen
- Degraded-Status statt fälschlicher Sicherheit

## Akzeptanzkriterien

- Die MVP-Events werden aus offiziellen Quellen oder explizit kuratierten Schedules erzeugt.
- Alle Events enthalten nachvollziehbare Quellenangaben.
- Zeitzonen und DST sind getestet.
- Forecast bleibt leer, wenn kein erlaubter Datenanbieter ihn liefert.
- Eventverschiebungen erzeugen keine Duplikate.
- Kalender- und Telegram-Views funktionieren ohne FMP.
- News-Risk-Blocking verarbeitet fehlende Daten konservativ.
