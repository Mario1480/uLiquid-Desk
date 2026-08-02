# Agent 6 – Future Feature: AI Market Intelligence statt klassischem News-Feed

## Produktvision

Der klassische News-Feed soll langfristig nicht die Hauptansicht sein. uLiquid Desk soll Nutzern eine priorisierte, erklärbare Market-Intelligence-Ansicht liefern.

Beispiel:

```text
Market Summary

⚠ US CPI in 18 hours – high expected volatility
↑ Bitcoin ETF flow reports remain constructive
↓ ETH funding weakened across monitored venues
! Major exchange security incident under review

Overall risk: High
Market tone: Mixed
Last updated: 14:05 UTC
```

## Informationsarchitektur

### 1. Today Overview

- Overall Market Risk
- Market Tone
- nächste High-Impact-Events
- wichtigste 3–5 News-Cluster
- Datenqualität / Providerstatus

### 2. Upcoming Events

Zeitachse für:

- Makrotermine
- Token-/Protocol-Events später optional
- geplante Börsenwartungen später optional

### 3. Market Drivers

Gruppiert nach:

- Macro
- Institutional
- Regulation
- Security
- Exchange
- Protocol

### 4. Assets to Watch

Nur beobachtungsorientiert:

- Symbol
- warum aktuell relevant
- positive/negative Katalysatoren
- Volatilitätsrisiko
- Link zur Prediction-Erstellung

Keine Buy-/Sell-Buttons.

### 5. Source Explorer

- Originalquellen eines Clusters
- Publisher
- Zeit
- externe Links
- Kennzeichnung AI Summary / Provider Metadata

## UX-Prinzipien

- maximal fünf Hauptaussagen auf der ersten Ansicht
- klare Zeitangaben
- Fakten, Daten und AI-Inferenz visuell unterscheiden
- Confidence nicht als Scheingenauigkeit darstellen
- `Data incomplete` sichtbar anzeigen
- Originalquellen immer erreichbar
- keine alarmistischen Farben für normale Marktbewegungen

## Nutzerpersonalisierung

Spätere Optionen:

- Watchlist-Symbole
- bevorzugte Regionen/Währungen
- Event-Importance
- Summary-Frequenz
- In-App-/Telegram-Benachrichtigungen
- nur kritische Hinweise

## Aktionen

Erlaubt:

- `View sources`
- `Create prediction`
- `Open chart`
- `Add to watchlist`
- `Mute topic`

Nicht erlaubt:

- direkter AI Trade
- automatische Order
- automatische Positionsänderung

## API-Anforderungen

`GET /market-intelligence/summary` unterstützt:

- Horizon
- Watchlist
- Region/Currency
- Sprache
- Kategorien

Response liefert Summary, Citations, Providerstatus und Generierungszeit.

## Progressive Umsetzung

### Phase A

- Summary Card auf dem Dashboard
- nächste Events
- drei News-Cluster

### Phase B

- eigene Market-Intelligence-Seite
- Source Explorer
- Watchlist-Personalisierung

### Phase C

- proaktive Alerts
- historischer Vergleich von Ereignissen
- optionale Reaktion des Marktes nach Event

## Akzeptanzkriterien

- Dashboard zeigt eine kompakte, belegte Summary.
- Nutzer kann jede Aussage bis zur Quelle zurückverfolgen.
- UI unterscheidet Fakten und AI-Inferenz.
- Degraded- und Stale-Zustände sind sichtbar.
- Mobile Darstellung ist priorisiert.
- Prediction-Erstellung übernimmt Kontext, löst aber keine Order aus.
