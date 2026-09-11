# 03 – AI Credit Billing

## Einheit

Empfohlen:

- 1 Credit = $0.001 Retail-Wert
- 1.000 Credits = $1.00
- alle Werte als `BigInt`
- Providerkosten intern in `microusd` speichern: 1 USD = 1.000.000 microusd

Dadurch bleibt die UI verständlich und die interne Berechnung präzise.

## Preisberechnung

```text
providerCostMicrousd =
  uncachedInputCost
+ cachedInputReadCost
+ cacheWriteCost
+ outputCost
+ billableToolCost
+ longContextSurcharge

retailCostMicrousd = ceil(providerCostMicrousd * markupBps / 10_000)
chargedCredits = ceil(retailCostMicrousd / 1_000)
```

`markupBps` enthält den Gesamtfaktor. Beispiel: 22000 BPS = 2,2x.

## Start-Markups

Nur Startwerte, administrativ konfigurierbar:

| Klasse | Faktor |
|---|---:|
| utility | 2,5x |
| standard | 2,2x |
| analysis | 2,1x |
| deep | 2,0x |

Zusätzlich Mindestbelastung pro erfolgreichem Run, z. B. 1 Credit. Keine Mindestbelastung bei einem Call ohne abrechenbare Provider-Nutzung.

## Reserve-and-Settle

### Ablauf

1. Router bestimmt Modell und Limits.
2. Cost Estimator berechnet Worst-Case-Reservierung aus maximalem Input, Output, Tool-Runden und Modellpreis.
3. Guthaben wird atomar reserviert.
4. Agent Run startet.
5. Jeder Model Call schreibt einen Usage Record.
6. Tatsächliche Gesamtkosten werden ermittelt.
7. Reservierung wird settled; Rest wird freigegeben.
8. Bei Fehlern werden nur tatsächlich angefallene Kosten belastet.

### Ledger Reasons

- `MONTHLY_GRANT`
- `TOPUP`
- `USAGE_RESERVE`
- `USAGE_SETTLE`
- `USAGE_RELEASE`
- `USAGE_REFUND`
- `ADMIN_ADJUST`
- `PROMO_GRANT`

## Abo und Top-ups

- Abo schaltet Agent Chat und Feature-Limits frei.
- Optional kleines monatliches AI-Credit-Inklusivguthaben.
- Kein unbegrenztes AI-Paket.
- Top-ups über vorhandenes Billing/Arbitrum-USDC-System.

Beispielpakete:

- 10.000 Credits / $10
- 25.000 Credits / $25
- 50.000 Credits / $50
- 100.000 Credits / $100

Pakete und Preise bleiben administrativ pflegbar.

## Ausgabenlimits

Pro Nutzer:

- Tageslimit
- Monatslimit
- Max Credits pro Run
- Warnschwelle
- Sol/Deep-Workflow nur nach sichtbarer Kostenschätzung

Plattformweit:

- max Calls pro Run
- max Tool Rounds
- max Input/Output Tokens
- max Context Tokens
- max reservierte Credits
- max tatsächliche Credits
