# ADR-001 – Legal Presale Model

## Status

`BLOCKED / LEGAL REVIEW REQUIRED`

Owner: Legal/Product

Gate: `NO-GO` für Production-Solidity-Contracts, Mainnet-Deployment, Presale und DEX-Launch.

## Technical candidate prepared on 2026-09-01

The repository now contains a review candidate with one purchase-bound USDC custody contract per round, buyer-initiated refunds, permissionless post-deadline finalization, and automatic backend finalization in fail-closed `OFF`/`OBSERVE`/`ACTIVE` modes. This does not change this ADR's status.

The proposed product rule is that the buyer submits and pays gas for a withdrawal. Legal must approve that rule explicitly against the requirement that a retail holder incur no fees or costs. If Legal does not approve it, Mainnet activation stops; the implementation must not silently enable sponsored withdrawals or reinterpret the requirement.

Legal must also confirm whether the proposed onchain USDC custody satisfies safeguarding duties and how an individual 14-calendar-day period interacts with the end of a time-limited subscription period. Any required change to custody, cancellation, access control, or deadline semantics reopens the contract specification before audit freeze.

## Context

ULIQ is planned as an optional utility, membership, and locking token on Arbitrum One. ADR-009 supersedes the earlier single-sale assumption with two Desk rounds totaling 150,000,000 ULIQ and an aggregate hard cap of 450,000 USDC.

The earlier assumption of an immediate 25% transfer at purchase was rejected. The current candidate first creates a pending allocation, models a 14-day withdrawal period, finalizes the full allocation into the isolated round vesting pool, and permits no claim before the shared DEX launch.

The technical candidate uses permissionless finalization for the immutable buyer, a 5% initial unlock for Round 1 and 25% for Round 2 at the shared DEX launch, and the invariant `pendingPurchaseCount == 0` before listing. These choices do not replace Legal review of withdrawal, refund, safeguarding, or cancellation semantics.

Ob, in welchem Umfang und mit welchen technischen/operativen Anforderungen dieses Modell rechtlich zulässig oder erforderlich ist, muss vor Contract-Freeze verbindlich geprüft werden.

## Decision

- Legal Review ist Phase 0.
- Pending Purchase, Withdrawal, Refund, Finalization, Cancellation und USDC Safeguarding werden nicht final in Production Contracts implementiert, bevor diese ADR freigegeben ist.
- Kein Soft Cap bedeutet nur, dass kein Refund wegen Nichterreichens eines Soft Caps vorgesehen ist.
- Gesetzliche, vertragliche und Emergency-/Cancellation-bedingte Refunds bleiben ausdrücklich möglich.
- bis zum Legal Go gilt das Arbeitsmodell:
  - Purchase erzeugt `PENDING_WITHDRAWAL`.
  - 0 ULIQ werden während der Withdrawal Period ausgegeben.
  - 0 ULIQ sind eligible und alle Benefits bleiben inaktiv.
  - wirksames Withdrawal führt zu Allocation Cancellation und USDC Refund nach finalen Sale Terms.
  - Finalization after the applicable deadline records 100% in the isolated round vesting pool; Round 1 unlocks 5% and Round 2 unlocks 25% only at the shared DEX launch.
- Die technische Working Assumption beträgt 14 Kalendertage pro Purchase. Die rechtliche Definition, Berechnung und mögliche freiwillige Verlängerung bleiben blockiert.
- `finalizePurchase(purchaseId)` ist nach Fristablauf technisch permissionless; der Beneficiary bleibt unveränderlich der Buyer und der Caller erhält weder Tokens noch Benefits.
- Bereits finalisierte Purchases werden bei vollständiger Sale Cancellation nicht irreversibel behandelt, bevor Legal Counsel die Semantik freigegeben hat.
- UI Copy, Terms, Whitepaper/Notification, Contract State Machine und Treasury-Flows müssen dieselbe freigegebene Legal-Semantik verwenden.

## Alternatives considered

### Sofortige 25%-Ausgabe beim Kauf

Verworfen als Arbeitsmodell, weil frei übertragbare Tokens eine mögliche spätere Rückabwicklung technisch und operativ erschweren.

### 100% sofortige Ausgabe

Verworfen aus demselben Grund und wegen fehlender Presale-Vesting-Semantik.

### Reines Offchain-Purchase-Ledger bis Sale-Ende

Kann Refunds vereinfachen, verschiebt aber Source of Truth und Custody stärker ins Backend. Nur nach Legal- und Security-Review zulässig.

### Restriktiver/privater Sale oder qualified-investor-only

Bleibt als rechtlich zu prüfende Alternative offen. Erfordert klare Zugangskontrollen und darf nicht nur durch UI-Geoblocking behauptet werden.

### Keine EU-/Retail-Teilnahme

Bleibt als Alternative offen. Jurisdiktions-, Geoblocking-, Wallet-/Identity- und Marketing-Folgen müssen belastbar geprüft werden.

## Consequences

- Contract Specification hängt von Legal Decisions ab.
- Presale USDC dürfen nicht automatisch als frei verfügbares Treasury-Guthaben behandelt werden.
- Purchase UI benötigt Deadline-, Withdrawal-, Refund- und Terms-States.
- Legal Acknowledgements müssen versioniert und Purchase-/Wallet-spezifisch rekonstruierbar sein.
- Cancellation ist auch ohne Soft Cap erforderlich.
- externer Launchpad-Sale benötigt eigene Prüfung und darf nicht still unter denselben Terms angenommen werden.
- DEX-Launch-Kommunikation kann Auswirkungen auf anwendbare Ausnahmen, Withdrawal und Marktmissbrauchspflichten haben.

## Security implications

- Refund- und Finalization-Pfade sind kapitalrelevant und müssen gegenseitig ausschließend sowie idempotent sein.
- USDC Safeguarding, Treasury Release und Emergency Actions benötigen Safe-/Multisig-Kontrolle.
- KYC-/Allowlist-Entscheidungen können zusätzliche Contract-Rollen, Signer, Merkle Roots oder Attestations erfordern.
- ein UI-only Gate verhindert keinen direkten Contract Call.
- Backend darf keine Multisig Private Keys besitzen.
- Logs, Admin UI und Support dürfen keine sensitiven KYC-Daten offenlegen.

## Legal implications

Durch spezialisierten Counsel verbindlich zu klären:

1. konkrete MiCA-Einstufung von ULIQ.
2. benötigtes Whitepaper und Notification-Verfahren.
3. zuständige Behörde und verantwortliche juristische Person.
4. zulässige EU- und Nicht-EU-Länder sowie Retail-Zugang und mögliche Ausnahmen.
5. konkrete Anwendbarkeit und Ausgestaltung einer 14-Tage-Withdrawal Period.
6. Verhältnis von Withdrawal Deadline und Sale-Ende; mögliche freiwillige Verlängerung.
7. Safeguarding der eingesammelten USDC.
8. KYC-, AML- und Sanktionsanforderungen.
9. Geoblocking und Restricted Jurisdictions.
10. DEX-Launch- und Admission-to-Trading-Auswirkungen.
11. optionaler externer Launchpad-Sale.
12. Sale Terms, Privacy, Tax/Accounting und Consumer Disclosures.
13. Cancellation und Refund.
14. zulässige Marketing Claims einschließlich Utility-, Referenzpreis- und Buyback-Sprache.
15. Behandlung bereits finalisierter Purchases bei einer Emergency-/Full-Sale-Cancellation.

## Open questions

- Wer ist Issuer, Offeror und rechtlich verantwortliche Entity?
- Welche technische Zugriffskontrolle muss der Presale Contract erzwingen?
- Beginnt die Deadline pro Purchase und wie wird sie exakt berechnet?
- Wo und wie werden USDC während Withdrawal und Sale verwahrt?
- Wer darf Refunds auslösen und wer trägt Gas?
- Was passiert bei Sale Cancellation mit bereits finalisierten Purchases?
- Welche Daten und Nachweise müssen für Audit, Behörde und Support aufbewahrt werden?
- Muss der Sale End vor jeder individuellen Withdrawal Deadline liegen oder darf die Periode darüber hinauslaufen?
- Welche konkreten Sale-End-/Withdrawal-Regeln gewährleisten, dass vor DEX Launch keine pending Purchases verbleiben?

## Exit criteria

- schriftliche Legal Classification und Jurisdiction Matrix.
- freigegebene Sale Terms, Withdrawal-/Refund-/Cancellation-Regeln.
- freigegebenes Safeguarding- und Treasury-Modell.
- freigegebene KYC/AML/Sanctions-/Geoblocking-Architektur.
- Whitepaper/Notification-/Marketing-Pflichten und Owner festgelegt.
- Contract- und UI-Spezifikation mit Legal Counsel abgeglichen.
- Status dieser ADR auf `ACCEPTED` geändert.
