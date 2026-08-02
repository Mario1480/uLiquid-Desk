# Agent 7 – Provider Admin, Health und Observability

## Auftrag

Ersetze die FMP-spezifische Administration durch ein generisches Provider Management.

## Admin-Bereiche

### Provider Übersicht

Je Provider:

- Name und Typ
- aktiviert/deaktiviert
- letzte erfolgreiche Synchronisierung
- letzte Fehlermeldung
- Latenz
- Datensatzanzahl
- Rate-Limit-Status, falls verfügbar
- Lizenzprüfung: pending/approved/blocked
- Quelle/Terms zuletzt geprüft am

### Secrets

API Keys nur für optionale API-Provider. RSS- und offizielle Sources benötigen keine Secrets.

Die vorhandene FMP-Key-UI darf während der Migration als Legacy-Bereich bestehen bleiben, wird danach entfernt.

## Health Modell

```ts
export type ProviderHealth = {
  providerId: string;
  state: "healthy" | "degraded" | "unavailable" | "disabled";
  checkedAt: string;
  lastSuccessAt?: string;
  latencyMs?: number;
  message?: string;
  staleDataAgeSeconds?: number;
  quota?: {
    remaining?: number;
    resetAt?: string;
  };
};
```

## Metriken

- Fetch success/failure pro Provider
- Parse failure
- neue/doppelte News Items
- Event Sync Count
- Stale Data Age
- AI Summary Success/Failure
- Summary Cache Hit Rate
- externe Request-Latenz
- Circuit Breaker State

## Alerts

Nur bei relevanten Zustandsänderungen:

- alle primären Newsquellen ausgefallen
- Wirtschaftskalender veraltet
- heutige High-Impact-Events nicht synchronisiert
- AI Summary wiederholt fehlgeschlagen
- Provider erholt sich

Telegram-System-Health-Job von festen Keys wie `fmp` auf dynamische Providergruppen umbauen.

## Audit

Änderungen an folgenden Einstellungen protokollieren:

- Provider aktivieren/deaktivieren
- Source Usage Status
- API Key setzen/löschen
- Refresh-Intervalle
- manuelle Resyncs

## Akzeptanzkriterien

- External Health ist nicht mehr auf `fmp` festgelegt.
- Admin kann Provider getrennt sehen und schalten.
- Secrets werden verschlüsselt und nie zurückgegeben.
- Telegram meldet gruppierte, verständliche Providerzustände.
- Alerts deduplizieren wiederholte Fehler.
- Lizenzprüfstatus ist als operativer Gate sichtbar.
