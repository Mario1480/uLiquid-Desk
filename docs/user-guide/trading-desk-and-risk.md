---
description: Manuelles Trading, Ordertypen, Positionen, Guardrails und Risikoverhalten.
icon: candlestick-chart
---

# Trading Desk und Risiko

Der Trading Desk ist die manuelle Trading-Oberflaeche. Er kann Orders vorbereiten, ausfuehren, offene Orders anzeigen und Positionen schliessen, sofern Rolle und Feature-Freischaltung passen.

{% hint style="danger" %}
Live-Orders koennen echtes Kapital bewegen. Pruefe Account, Symbol, Side, Ordertyp, Menge, Hebel, Stop Loss und Take Profit vor jeder Bestaetigung.
{% endhint %}

## Typischer Ablauf

1. Exchange-Account und Symbol waehlen.
2. Live-Datenstatus pruefen.
3. Ordertyp waehlen.
4. Menge, Preis und Risikowerte eintragen.
5. Warnungen lesen.
6. Order absenden.
7. Offene Orders und Positionen nach Refresh pruefen.

## Ordertypen

| Typ | Nutzung |
| --- | --- |
| Market | Schnelle Ausfuehrung zum aktuellen Marktpreis, mit Slippage-Risiko. |
| Limit | Ausfuehrung nur zum Limit oder besser, kann offen bleiben. |
| Cancel | Einzelne offene Order abbrechen. |
| Cancel All | Alle offenen Orders im Scope abbrechen. |
| Close Position | Bestehende Position reduzieren oder schliessen. |

## Sicherheitsverhalten

Der Desk blockiert oder warnt bei:

- unsicheren oder degradierten Marktdaten,
- fehlenden Trading-Rechten,
- laufender identischer Aktion,
- fehlender Re-Auth,
- unvollstaendiger Account- oder Symbolauswahl,
- kritischen Close-/Cancel-All-Aktionen.

## Idempotenz

Riskante Live-Aktionen werden mit einem eindeutigen Key abgesichert. Dadurch sollen Browser-Retries oder Doppelklicks nicht versehentlich mehrere Live-Aktionen ausloesen.

## Position schliessen

Nach einem Close prueft der Server frische Live-Daten. Eine Position gilt intern erst als geschlossen, wenn kein Rest-Exposure mehr sichtbar ist. Falls noch Exposure existiert oder ein Read fehlschlaegt, bleibt der Status vorsichtig offen beziehungsweise pending.

## Risiko-Settings

Risk Controls koennen unter Einstellungen gepflegt werden. Typische Parameter:

- Tagesverlustgrenzen.
- Margin-Schwellwerte.
- erlaubte Ordertypen.
- Rollen fuer Market- und Limit-Orders.
- Workspace-Defaults fuer Trading und Bots.

## Notfallverhalten

Wenn Daten unsicher wirken:

1. Keine neuen Orders starten.
2. Exchange UI direkt pruefen.
3. Offene Orders und Positionen gegenpruefen.
4. Account-Sync abwarten oder Operator informieren.
5. Support-Paket mit Zeitstempel und Account-ID sammeln.
