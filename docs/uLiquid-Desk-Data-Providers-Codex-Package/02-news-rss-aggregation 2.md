# Agent 2 – Kostenloser RSS-/Atom-News-Aggregator

## Auftrag

Implementiere einen serverseitigen News-Aggregator auf Basis von RSS/Atom. Ziel ist eine kostengünstige Basis für Crypto-, Makro-, Regulierungs- und Börsennews.

## Wichtiger Lizenzgrundsatz

Ein öffentlich erreichbarer Feed bedeutet nicht automatisch, dass vollständige Inhalte frei erneut veröffentlicht werden dürfen. Standardmäßig nur folgende Felder verarbeiten und anzeigen:

- Titel
- sehr kurzer Teaser, sofern im Feed vorgesehen
- Publisher
- Veröffentlichungszeit
- Original-Link
- intern erzeugte Tags und Zusammenfassung

Keine vollständigen Artikeltexte spiegeln. Jede Quelle benötigt einen Eintrag in einer Source Registry mit manuell geprüftem Nutzungsstatus.

## Source Registry

```ts
export type RssSourceConfig = {
  id: string;
  name: string;
  feedUrl: string;
  homepageUrl: string;
  enabled: boolean;
  categories: string[];
  defaultLanguage: string;
  fetchIntervalMinutes: number;
  termsReviewedAt?: string;
  usageStatus: "pending_review" | "approved" | "blocked";
};
```

Nur `approved`-Quellen dürfen in Produktion aktiviert werden.

## Kategorien

- `crypto_market`
- `macro`
- `regulation`
- `exchange`
- `security_incident`
- `protocol`
- `institutional`
- `stablecoin`

## Pipeline

```text
Fetch feed
  → parse safely
  → sanitize URLs/text
  → normalize timestamps
  → canonicalize URL
  → compute content hash
  → deduplicate
  → classify symbols/categories
  → persist metadata
  → optional AI summary queue
```

## Sicherheit

- SSRF-Schutz für Feed URLs
- nur `https`, optional explizite Allowlist
- Redirect-Limit
- Response-Größenlimit
- Timeout
- XML Entity Expansion verhindern
- HTML sanitizen
- Credentials und Trackingparameter aus URLs entfernen

## Deduplizierung

Kombiniere:

- Canonical URL
- normalisierten Titel
- Publisher
- Zeitfenster
- Content Hash
- optionale semantische Ähnlichkeit erst später

Mehrere Quellen dürfen zum gleichen Thema erhalten bleiben, sollen aber zu einem `NewsCluster` gruppiert werden können.

## Symbol-Erkennung

Zunächst deterministisch:

- bekannte Ticker
- Projektnamen und Aliase
- Börsennamen
- Stablecoins

AI-Klassifizierung nur als ergänzender asynchroner Schritt.

## Optionaler Marketaux-Adapter

Implementiere ihn nur als optionalen Adapter hinter demselben Contract. Keine Annahme, dass der kostenlose Tarif für die produktive SaaS-Nutzung ausreicht. Konfiguration standardmäßig deaktiviert, bis Lizenz und Limits geprüft wurden.

## API

- `GET /news`
- Filter: Kategorie, Symbol, Sprache, Zeitraum, Publisher
- Cursor Pagination
- Response enthält Quellenattribution
- kein externer Feed wird direkt vom Browser geladen

## Akzeptanzkriterien

- Mindestens drei konfigurierbare Testfeeds funktionieren über einen gemeinsamen Adapter.
- Doppelte Feed-Einträge werden erkannt.
- Fehlerhafte Feeds beeinträchtigen andere Quellen nicht.
- Nur freigegebene Sources laufen in Production.
- Original-Link und Publisher sind immer sichtbar.
- Vollständige Artikeltexte werden nicht persistiert oder zurückgegeben.
- Tests decken Parser, SSRF-Schutz, Sanitizing, Deduplizierung und Degraded Mode ab.
