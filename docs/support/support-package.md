---
description: Welche Informationen Support oder Operatoren fuer eine schnelle Analyse brauchen.
icon: package-check
---

# Support-Paket sammeln

Ein gutes Support-Paket spart Zeit und verhindert Missverstaendnisse. Sammle bei jedem Vorfall moeglichst konkrete Informationen.

## Mindestinformationen

- Workspace-Name oder Workspace-ID.
- User-E-Mail oder User-ID.
- Zeitpunkt mit Zeitzone.
- Betroffene Seite.
- Aktion, die ausgefuehrt wurde.
- Erwartetes Ergebnis.
- Tatsaechliches Ergebnis.
- Screenshot oder Bildschirmaufnahme.

## Trading-Faelle

Zusaetzlich:

- Exchange.
- Exchange-Account Label oder ID.
- Symbol.
- Ordertyp.
- Side.
- Menge, Preis, Leverage.
- Order-ID oder Client-ID, falls vorhanden.
- Position vor und nach der Aktion.
- Screenshot aus Exchange UI, falls Live.

## Bot- und Grid-Faelle

Zusaetzlich:

- Bot-ID oder Grid-Instance-ID.
- Template-ID.
- Runner-Status.
- letzter Fehlertext.
- Preview-Status und Warning Codes.
- Funding- oder BotVault-ID.

## Wallet- und Funding-Faelle

Zusaetzlich:

- Wallet-Adresse.
- Netzwerk.
- Tx-Hash.
- Asset und Betrag.
- Quelle und Ziel.
- Pending- oder Confirmed-Status.
- Balance vor und nach dem Flow.

## Admin-/Security-Faelle

Zusaetzlich:

- Rolle des Users.
- erwartete Permission.
- Audit-Eintrag, falls vorhanden.
- Fehlermeldung wie `403`, `429`, `invalid_or_expired_code`.

{% hint style="info" %}
Teile niemals API-Secrets, Private Keys, Seed Phrases oder OTP-Codes im Support-Paket.
{% endhint %}
