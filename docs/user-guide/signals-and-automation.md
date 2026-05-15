---
description: Prognosen, Strategien, Bots und Grid Bots sicher nutzen.
icon: bot
---

# Signale und Automatisierung

uLiquid Desk buendelt Prognosen, Strategien, normale Bots und Grid Bots. Der sichere Weg ist: Signal verstehen, Risiko pruefen, zuerst simulieren oder klein testen, dann erst automatisieren.

## Prognosen

Prognosen analysieren Marktinformationen und erzeugen Setups. Sie koennen den Trading Desk vorfuellen, fuehren aber nicht automatisch eine Order aus.

Empfohlener Ablauf:

1. Symbol und Zeitfenster waehlen.
2. Strategie oder Signalquelle pruefen.
3. Confidence, Tags und Begruendung lesen.
4. Setup in den Trading Desk senden.
5. Orderdetails manuell pruefen.

## Strategien

Strategien koennen AI-basiert, lokal deterministisch oder composite sein.

| Modus | Zweck |
| --- | --- |
| AI | Bewertung und Erklaerung komplexer Setups. |
| Lokal | Deterministische Regeln fuer stabile, wiederholbare Ergebnisse. |
| Composite | Verkettet lokale und AI-Schritte. Vor Aktivierung per Dry-Run pruefen. |

## Normale Trading Bots

Normale Bots fuehren Strategie-Logik automatisiert aus. Pruefe vor dem Start:

- Exchange-Account und Symbol.
- Berechtigungen.
- Investitions- und Risiko-Limits.
- Status des Runners.
- Letzte Strategieauswertung.
- Stop-/Pause-Verhalten.

## Grid Bots

Grid Bots platzieren Orders innerhalb einer Preisrange. Sie sind besonders sensibel fuer Kapital, Hebel, Range, Grid-Anzahl und Liquidationsabstand.

Vor dem Start:

1. Template waehlen.
2. Symbol, Range, Hebel und Grid Count pruefen.
3. Preview berechnen.
4. Mindestinvestment, Reserve und Liquidationsdistanz pruefen.
5. Funding-Quelle waehlen.
6. BotVault-/Funding-Status pruefen.
7. Erst starten, wenn die Preview bereit ist.

## Grid Bot Warnungen

| Warnung | Bedeutung |
| --- | --- |
| Budget zu niedrig | Das Kapital reicht fuer Venue-Minima oder Grid-Struktur nicht aus. |
| Erhoehtes Liq-Risiko | Liquidationsabstand ist knapp. Range, Hebel oder Reserve anpassen. |
| Zu viele Grids | Per-Grid-Kapital ist zu duenn. Grid Count reduzieren oder Budget erhoehen. |
| Venue Constraints fehlen | Exchange-Metadaten sind unvollstaendig. Nicht live starten. |

## Wann stoppen?

Stoppe oder pausiere Automatisierung, wenn:

- Accountdaten degradiert sind,
- Runner-Fehler auftreten,
- offene Positionen nicht plausibel sind,
- Funding oder BotVault nicht reconciled ist,
- externe Marktbedingungen nicht mehr zur Strategie passen.
