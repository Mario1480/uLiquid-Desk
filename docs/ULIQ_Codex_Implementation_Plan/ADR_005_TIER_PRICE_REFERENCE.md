# ADR-005 – Tier Price Reference

## Status

`ACCEPTED`

Deployment-Parameter offen: konkrete DEX-/Pool-Adresse und die davon abhängigen Pre-Audit-Parameter.

## Context

ULIQ Tiers sollen zunächst USD-equivalent sein. Vor dem DEX Launch existiert kein belastbarer Marktpreis. Nach dem Launch kann ein einzelner Spot-Tick eines jungen, möglicherweise illiquiden Pools manipuliert werden und darf keine monetären Benefits steuern.

Pending Presale Allocations sind unabhängig vom Price Mode nicht eligible. Nur finalisierte Wallet-, unreleased Vesting- und Locked-Bestände werden bewertet.

## Decision

Aktuelle Tier-Schwellen:

| Tier | Mindestwert |
| --- | ---: |
| Basic | unter 100 USD-equivalent |
| Bronze | 100 USD-equivalent |
| Silver | 500 USD-equivalent |
| Gold | 1.500 USD-equivalent |
| Platinum | 5.000 USD-equivalent |

Bei 0,001 USD `PRESALE_REFERENCE` entspricht dies:

| Tier | ULIQ |
| --- | ---: |
| Basic | 0 |
| Bronze | 100.000 |
| Silver | 500.000 |
| Gold | 1.500.000 |
| Platinum | 5.000.000 |

### Vor DEX Launch

- Price Mode: `PRESALE_REFERENCE`.
- Reference Price: 0,001 USD pro ULIQ.
- gilt nur als interner Utility-Referenzwert für finalisierte Presale Allocations.
- ist kein Marktpreis, Preisziel oder Rücknahmeversprechen.
- pending/withdrawn Allocations bleiben inaktiv.

### `MARKET_OBSERVATION`

- Nach DEX Launch beginnt eine feste Observation Period von 30 Tagen.
- DEX-, Preis- und Liquidity-Daten werden gesammelt; die Tier Engine verwendet weiterhin `PRESALE_REFERENCE`.
- Es gibt keine automatische Market-Price-Aktivierung.

### `MARKET_REFERENCE`

- Umschaltung erfolgt erst nach erfüllten, überwachten und admin-freigegebenen Qualitätskriterien.
- Preisbasis ist ausschließlich ein 24h TWAP, kein Spot- oder einzelner Blockpreis.
- Pool Age mindestens 30 Tage.
- ausreichende 24h-TWAP-Historie.
- Pool TVL mindestens 50.000 USD.
- unter 50.000 USD Pool TVL ist `MARKET_REFERENCE` deaktiviert.
- Price Feed healthy und höchstens 30 Minuten alt.
- Spot-vs-24h-TWAP-Abweichung höchstens 25 % für neue Upgrades.
- jeder Tier-/Discount-Snapshot speichert Price Mode, Price Snapshot ID, Block Number, Block Hash, Config Version und Gültigkeit.
- kein einzelner Spot-Tick wird verwendet.

Bei Staleness, Feed Failure oder Spot/TWAP-Abweichung über 25 %:

- kein neues Tier-Upgrade.
- keine automatische oder erzwungene Herabstufung.
- bestehendes Tier temporär halten.
- Operations Alert erzeugen.

Vor Audit final festzulegen:

- DEX.
- Pool Address.
- Quote Asset USDC.
- Fee Tier.
- konkrete 24h-TWAP-Implementierung.
- Failover Source.

## Alternatives considered

### Reine ULIQ-Token-Schwellen

Weniger Oracle-Risiko und einfacher zu erklären, reagiert aber nicht auf wirtschaftliche Wertänderungen. Bleibt als Fallback offen, falls Market Price Mode nicht sicher betreibbar ist.

### Sofortiger DEX Spot-Preis

Verworfen wegen Manipulations-, Staleness- und Low-Liquidity-Risiko.

### Presale Reference dauerhaft

Sehr stabil, kann nach Markteinführung aber deutlich vom Marktwert abweichen. Als langfristige Policy nur nach Product/Legal Review.

### Externer zentraler Preisprovider

Kann Failover liefern, schafft aber Provider-/Listing-/Staleness-Abhängigkeit.

### Onchain TWAP eines einzelnen Pools

Besser als Spot, aber bei geringer Liquidität weiterhin manipulierbar und ausfallanfällig.

## Consequences

- Price Service und Admin benötigen explizite Modes und Aktivierungszustände.
- DEX Launch und Market Price Mode sind getrennte Operations.
- historische Billing-/Benefit-Entscheidungen bleiben über Price Snapshot rekonstruierbar.
- UI muss Reference Price und Market Price klar unterscheiden.
- bei Feed-Störung bleibt das letzte bestätigte Tier erhalten; neue Upgrades bleiben gesperrt und jede neue Reservation dokumentiert den gehaltenen Tier-/Degradation-State.

## Security implications

- Preismanipulation kann direkte Subscription-/AI-Discount-Kosten verursachen.
- Upgrades benötigen einen frischen qualifizierten Snapshot; stale/degraded Daten können kein höheres Tier erzeugen.
- mehrere Sources, Liquidity/Pool-Age-Gates und Max-Deviation reduzieren, beseitigen aber Manipulationsrisiko nicht.
- Admin-Aktivierung benötigt Superadmin, Reauth, Vier-Augen- und Audit-Trail.
- Blockkonsistenz zwischen Price und Balance Snapshot ist erforderlich.

## Legal implications

- Presale Reference darf nicht als garantierter Marktwert oder Preisprognose kommuniziert werden.
- Tier- und Discount-Regeln müssen klar, fair und versioniert beschrieben werden.
- DEX-/Market-Making-Beziehungen und mögliche Interessenkonflikte sind offenzulegen beziehungsweise rechtlich zu prüfen.

## Open questions

- konkrete DEX- und Pool-Auswahl.
- primärer und Failover-Oracle/Provider.
- ob Price Snapshot Block exakt dem Entitlement `asOfBlock` entsprechen muss oder ein eng definiertes Fenster erlaubt ist.
- Verhalten bei starkem Preissturz/-anstieg.
- ob monetäre Discounts konservativ auf einen Max-Reference-Price begrenzt werden.
- Trigger und Authority für Rückkehr zu `PRESALE_REFERENCE` beziehungsweise für einen gehaltenen degraded Quality State ohne Mode-Wechsel.

## Acceptance criteria

- Market Price Mode kann nicht ohne vollständige Config und Approval aktiviert werden.
- die ersten 30 Tage nach DEX Launch bleiben `MARKET_OBSERVATION` mit 0,001 USD Utility Reference.
- Market Reference verwendet 24h TWAP und verlangt Pool TVL >= 50.000 USD.
- Spot-Tick allein verändert kein Tier.
- Spot/TWAP-Abweichung > 25 %, Staleness > 30 Minuten oder Feed Failure verhindert Upgrades, hält bestehende Tiers und erzeugt einen Alert.
- jeder Discount ist auf einen unveränderlichen Price Snapshot rückführbar.
- UI kennzeichnet den aktiven Mode korrekt.
