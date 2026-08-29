# Premium Plan Gating – Stage 0 Repo- und Datenmodell-Audit

Stand: 2026-08-25
Audit-Basis: Commit `4b1b6b755e72a10b49d8e749f3da12b487ba9896` auf `codex/uliq-mvp-testnet`
Quellen: `CODEX_TASK_Premium_Plan_Gating_v1.0.md` und `uLiquid_Desk_Pricing_Subscriptions_v1.0_2026-08-24.pdf`

## 1. Scope und Autoritätsgrenze

Dieser Stand schließt ausschließlich Stage 0 ab:

- statischer Repo- und Datenmodell-Audit,
- Enterprise-Kompatibilitätsanalyse,
- additiver Migrations- und Rollout-Plan,
- Testplan und Abnahmekriterien für die nachfolgenden Stages.

Die beiden externen Dokumente wurden als Produkt- und Implementierungsspezifikation ausgewertet. Sie sind keine zusätzliche Autorisierung für Datenbankzugriffe, Migrationen, Deployments, Zahlungen, Wallet-Signaturen oder Production-Änderungen.

Nicht ausgeführt wurden:

- keine Prisma- oder SQL-Migration,
- kein lokaler oder externer Daten-Backfill,
- keine Verbindung zu Staging- oder Production-Datenbanken,
- kein Deployment,
- kein Checkout, keine Wallet-Aktion und keine Onchain-Transaktion,
- keine Änderung an Runtime-Gates, Preisen, Paketen oder Nutzerentitlements.

Die bereits vorhandenen Working-Tree-Änderungen in `apps/web/app/admin/uliq/page.tsx` und `apps/web/app/styles/bots-wallet.css` wurden nicht angefasst.

## 2. Stage-0-Ergebnis

Status: **Repo-/Datenmodell-Audit verifiziert; Live-Datenbestand unbekannt; Migration und Deployment offen.**

Das Zielmodell ist im bestehenden System additiv umsetzbar. Vor einer Freigabe zur Implementierung müssen jedoch mehrere vorhandene Drift- und Bypass-Pfade geschlossen werden. Ein bloßes Hinzufügen von `PREMIUM` zum Prisma-Enum und einer Pricing Card wäre nicht ausreichend und würde teilweise falsche oder umgehbare Entitlements erzeugen.

### Kritische Befunde

| Priorität | Befund | Auswirkung |
| --- | --- | --- |
| P0 | `normalizePlanTier()` und die Strategy-License-Normalisierung stufen unbekannte Werte auf `pro` hoch. | Ungültige oder neue Planwerte können bezahlte Capabilities erhalten. |
| P0 | Die Produkt-Capability-Stufe wird über `LicenseEntitlement`/Strategy-Entitlements abgeleitet; fehlende Rows defaulten ebenfalls auf `pro`. | Billing und Capability-Auflösung können für denselben Nutzer unterschiedliche Pläne liefern. |
| P0 | Der direkte Position-Copilot unter `/api/position-copilot/*` ist nur auth-geschützt. | Pro/Free könnten die Premium-Grenze am separaten Trade-Desk-Endpunkt umgehen. |
| P0 | Grid-Start/Resume nutzt nicht den zentralen Bot-Slot-Startguard. | Grid Bots können das gemeinsame aktive Bot-Limit umgehen. |
| P0 | Free Grid ist durch `product.grid_bots`/Plugin-Gates und zusätzliche Pro-only-Vault-Routen blockiert. | Das Freischalten der Navigation allein erzeugt keinen nutzbaren Free-End-to-End-Flow. |
| P0 | Beim ULIQ-Rabatt wird jeder Nicht-nur-AI-Topup-Warenkorb als Subscription-Rabatt klassifiziert. | Kapazitäts-Add-ons würden entgegen v1 rabattiert; bei gemischten Warenkörben wird der Rabatt auf den Gesamtbetrag verteilt. |
| P1 | `maxExchangeAccounts` existiert nicht; `allowedExchanges` ist nur eine Venue-Allowlist. | Das Free-Limit von einem verbundenen Exchange Account ist serverseitig nicht ausdrückbar. |
| P1 | Ein Paper Account ist eine eigene `ExchangeAccount`-Row und benötigt bereits einen verknüpften echten Account. | Würde Paper mitzählen, könnte Free die enthaltene Paper-Trading-Funktion nicht zusammen mit dem einen echten Account nutzen. |
| P1 | Aktive Kapazitätsgrants und Checkout-Regeln sind auf `PRO` fest verdrahtet. | Add-ons funktionieren nicht automatisch für Premium und können bei Planwechseln verschwinden. |
| P1 | Term-Snapshot-Parser interpretiert jeden Nicht-`FREE`-Wert als `PRO`. | Unbekannte oder zukünftige Snapshot-Pläne werden nach oben normalisiert; `PREMIUM` würde als Pro gelesen. |
| P1 | Das Operator-Skript `set-user-plan.ts` kennt nur Free/Pro und enthält einen Fallback von 1.000.000 monatlichen Credits. | Ein fehlendes/defektes Pro-Paket kann im manuellen Pfad eine deutlich zu hohe Gutschrift erzeugen. |
| P1 | `ensureBillingDefaults()` korrigiert bestehende Free-/Pro-Pakete nicht vollständig. | Neue Konstanten allein migrieren keine bereits vorhandenen Paketwerte. |
| P1 | Frontend-Feature-Gates defaulten bei fehlendem Gate auf `allowed=true`. | Bei unvollständigem Entitlement-Payload können Aktionen sichtbar/anklickbar werden, obwohl der Server sie später ablehnt. |

## 3. Verifiziertes Zielmodell

### 3.1 Kommerzielle Pläne

| Entitlement | Free | Pro | Premium |
| --- | ---: | ---: | ---: |
| Preis/Monat | $0 | $29 | $69 |
| Gezählt verbundene Exchange Accounts | 1 | `null` = kommerziell unbegrenzt | `null` = kommerziell unbegrenzt |
| Gemeinsame aktive Bot-Slots | 2 | 5 | 15 |
| Aktive AI-Prediction-Schedules | 0 | 3 | 10 |
| Aktive Composite-Schedules | 0 | 2 | 5 |
| Monatlich enthaltene AI Credits | 0 | 10.000 | 30.000 |

`null` muss in Quota-Feldern zentral als „kein vermarktetes Count-Limit“ interpretiert werden. Ein technisches Fair-Use-Limit muss separat benannt und darf nicht als kommerzielles Limit angezeigt werden.

### 3.2 Capability-Rang

Empfohlenes internes Rangmodell:

`free < pro < premium < enterprise`

Dabei bleiben zwei Domänen bewusst getrennt:

- **CommercialBillingPlan:** `free | pro | premium`
- **CapabilityPlanTier:** `free | pro | premium | enterprise`

`enterprise` bleibt ein interner/vertraglicher Capability-Tier und wird durch diese Arbeit nicht zu einem öffentlich kaufbaren Billing-Paket. Nur ein explizit gespeicherter, verifizierter Enterprise-Override darf den aktiven kommerziellen Plan auf Capability-Ebene erhöhen. Fehlende oder ungültige Werte dürfen das nicht.

## 4. Repo- und Datenmodell-Inventar

### 4.1 Prisma und persistierte Entitlements

| Modell/Feld | Ist-Zustand | Erforderliche Änderung |
| --- | --- | --- |
| `EffectivePlan` | Nur `FREE`, `PRO` | Additiv `PREMIUM`; Enterprise bleibt außerhalb des kommerziellen Enums. |
| `UserSubscription.effectivePlan` | Free/Pro-Snapshot | Premium unterstützen. |
| `UserSubscription.proValidUntil` | Pro-spezifischer Legacy-/Cache-Name | Beibehalten; additiv generisches `planValidUntil`, dual-read/dual-write bis separater Cleanup. |
| `UserSubscription.maxRunningBots` | Default 1 | Canonical Free/Pro/Premium 2/5/15. |
| Prediction-Quota-Felder | Nullable; Free fällt derzeit auf `null` | Free explizit auf 0; Premium 10/5. |
| `allowedExchanges` | Venue-Allowlist | Unverändert behalten; nicht für Count-Quota missbrauchen. |
| `maxExchangeAccounts` | Fehlt | Additiv auf `UserSubscription` und `BillingPackage`: Free 1, Pro/Premium `null`. |
| `BillingPackage.plan` | Nullable mit DB-Default `PRO` | Premium unterstützen; semantisch nur für `PLAN` verwenden. Add-ons nicht über einen exakten Zielplan modellieren. |
| `BillingPackage` | Kein Premium-Paket | Canonical `premium_monthly` mit $69/15/10/5/30k. |
| `SubscriptionTerm` | Plan nur im JSON-Snapshot | Additiv typisiertes `plan EffectivePlan?`, anschließend verifiziert backfillen und später `NOT NULL`; JSON-Snapshot bleibt unverändert Teil der Abrechnungsevidenz. |
| `SubscriptionTerm.entitlementSnapshot` | Immutable JSON, Parser nur Free/Pro | Snapshot-Schema versionieren und Premium sowie `maxExchangeAccounts` explizit lesen. Unbekannt fail-closed. |
| `BillingOrderItem.packageSnapshot` | Immutable JSON ohne Account-Count | Feld additiv in neue Snapshots aufnehmen; historische Snapshots nicht umschreiben. |
| `SubscriptionCapacityGrant.planScope` | Exakter `EffectivePlan`, neue Grants hart `PRO` | Neue termgebundene Capacity-Grants planübergreifend für Pro/Premium auswerten; Legacy-PRO-Grants kompatibel erhalten. |
| AI Credit Ledger/Reservations | Kostenbasiert, idempotente Keys vorhanden | Unverändert erhalten; keine Balance-/Ledger-Resets. |
| `LicenseEntitlement.plan` | Freier String, Default `pro` | `premium` zulassen, unbekannt fail-safe behandeln, explizites `enterprise` schützen. |

Zusätzlicher Legacy-Befund: `packages/core/src/license.ts` enthält ein separates `maxCex`-Modell, wird außerhalb seiner Tests aber nicht verwendet. Es darf nicht als zweiter Subscription-Entitlement-Pfad reaktiviert werden. Der neue Account-Count gehört in den bestehenden Billing-/Subscription-Resolver.

### 4.2 Billing und Subscription Lifecycle

Verifiziert in `apps/api/src/billing/service.ts`:

- Öffentlicher `EffectivePlan` ist nur `free | pro`.
- Free hat derzeit 1 Bot sowie `null` für AI-/Composite-Schedules; `null` wirkt als unbegrenzt und ist nicht das Ziel 0.
- Pro hat 3 Bots, 3 AI- und 2 Composite-Schedules sowie 10.000 monatliche Credits.
- Die vier freigegebenen AI-Topups entsprechen bereits 10k/$10, 25k/$25, 50k/$50 und 100k/$100.
- Die drei aktiven Capacity-Add-ons kosten bereits $5 und sind getrennt modelliert.
- `ensureBillingDefaults()` legt fehlende Pakete an, aktualisiert vorhandene Free-/Pro-Werte aber nicht vollständig (`free update: {}`, Pro im Wesentlichen nur Credits).
- `planSubscriptionTermWindow()` hängt einen weiteren bezahlten Term an das Ende des letzten Terms an. Ein Premium-Kauf während eines aktiven Pro-Terms wäre daher ohne Zusatzlogik ein geplanter Wechsel zum Laufzeitende, kein sofortiges/proratiertes Upgrade.
- Monthly Grants haben idempotente Keys; Reservation, Settlement, Release und Kosten-Snapshots sind vorhanden und müssen erhalten bleiben.
- Add-on-Grants werden mit `planScope: PRO` geschrieben.
- Der Term-Parser mappt jeden Snapshot-Plan außer `FREE` auf `PRO`.
- `syncPrimaryWorkspaceEntitlementsForUser()` koppelt erweiterte AI-/Composite-Capabilities an `monthlyAiCreditsIncluded > 0`. Ein Promo-Credit kann dadurch ungewollt eine Pro-Capability-Hülle erzeugen.

### 4.3 Capability-Quelle und Enterprise

Verifiziert:

- `@mm/core` kennt `free | pro | enterprise`, aber kein Premium.
- Unbekannte Werte normalisiert `normalizePlanTier()` zu `pro`.
- Enterprise erbt aktuell Pro-Capabilities.
- Die Strategy-License besitzt eine spezifische Enterprise-Regel: standardmäßig 64 Composite Nodes statt 12 bei Pro.
- API-, Runner- und Plugin-Policy-Snapshots serialisieren die Plan-Stufe und kennen Premium noch nicht.
- `resolvePlanCapabilitiesForUserId()` leitet den Plan aus `LicenseEntitlement`/Strategy-Entitlements ab, nicht direkt aus dem aktiven Billing-Term.
- Fehlt eine `LicenseEntitlement`-Row, verwendet `STRATEGY_LICENSE_DEFAULT_PLAN` beziehungsweise der Default `pro`.
- Ein Free-Strategy-Entitlement mit AI-/Composite-Kinds oder positivem Composite-Limit wird als Pro-Capability-Plan interpretiert.
- Der Billing-Sync kann ein vorhandenes Enterprise-Entitlement derzeit mit Free/Pro überschreiben.

Zielentscheidung für die Implementierung:

1. Der aktive Billing-Term beziehungsweise ein sicherer Free-Fallback ist die Autorität für den kommerziellen Plan.
2. Ein explizites `LicenseEntitlement.plan = enterprise` darf als interner Override darüberliegen und bleibt unverändert.
3. Strategy-spezifische Allow-/Deny-Overrides bleiben zusätzlich wirksam, bestimmen aber nicht still den kommerziellen Produktplan.
4. Promo-/Topup-Credits verändern niemals Plan-Capabilities.
5. Unbekannte Strings, fehlende Rows und ungültige Snapshots normalisieren zu Free beziehungsweise liefern eine nicht verfügbare Entitlement-Antwort; niemals zu Pro/Premium/Enterprise.
6. Die Enterprise-64-Node-Regel sowie vorhandene explizite DB-Overrides bleiben erhalten.

### 4.4 Gemeinsamer aktiver Bot-Pool

Positiv verifiziert:

- Normaler Trading Bot und Prediction Copier werden als `Bot` gespeichert.
- Grid Bot besitzt ebenfalls eine verknüpfte `Bot`-Row.
- Der bestehende Usage-Count `Bot.status = running` deckt dadurch grundsätzlich alle drei Kategorien gemeinsam ab.
- Normaler Bot und Prediction Copier werden `stopped` erstellt und verbrauchen erst beim Start einen Slot.
- Grid Pause setzt die Grid-Instanz auf `paused` und die Bot-Row auf `stopped`; dadurch wird Kapazität freigegeben.
- Prediction Copier nutzt den normalen Bot-Startpfad und damit den aktuellen Bot-Startguard.

Lücken:

- Die konsumierende Statusmenge ist nicht als zentraler Helper benannt und getestet; der Query-Literal `status: running` ist nur implizite Wahrheit.
- Grid Start und Resume rufen `startGridInstanceNow()` auf, ohne `enforceBotStartLicense()` beziehungsweise einen gemeinsamen Admission-Service zu verwenden.
- Count-then-update ist nicht gegen zwei gleichzeitige Starts serialisiert. Zwei parallele Starts können denselben freien Slot sehen.
- `error` verbraucht aktuell keinen Slot. Das passt nur, wenn der Runner dabei garantiert keine aktive Runtime-/Order-Kapazität hält; dieser Invariant muss als Status-Test festgeschrieben werden.
- Bestehende, nach Downgrade überzählige laufende Bots werden nicht automatisch gestoppt. Empfohlen ist ein nicht-destruktives Modell: laufende Instanzen bleiben verwalt-/stoppbar, neue Starts werden bis unter das Limit blockiert.

Zielservice:

- eine zentrale Konstante beziehungsweise Funktion `ACTIVE_BOT_CAPACITY_STATUSES`, initial exakt `running`,
- ein gemeinsamer Start-/Resume-Admission-Service für Trading Bot, Grid Bot und Prediction Copier,
- Serialisierung pro User, bevorzugt über DB-Transaktion plus transaktionalen Advisory Lock oder gleichwertige Sperre,
- erneuter Count innerhalb derselben Sperre direkt vor dem Zustandswechsel,
- keine Limits auf Draft-/Create-Vorgänge.

### 4.5 Free Grid End-to-End

Der aktuelle Free-Pfad ist nicht funktionsfähig:

- `product.grid_bots`, `execution.mode.grid`, `strategy.kind.futures_grid` und `strategy.kind.prediction_copier` sind derzeit Pro-Capabilities.
- Der Grid-Katalog lädt `/vaults/bot-vaults?reusableOnly=true` in einem nicht abgefangenen `Promise.all`; ein Vault-403 lässt bereits die Katalog-Metadaten fehlschlagen.
- Der Katalog lädt zusätzlich `/vaults/funding-vault`.
- Die Onchain-Provisionierung verwendet direkte Vault-Endpunkte für `reserve-tx` und `fund-hypercore-tx`.
- Alle diese Vault-Routen verlangen pauschal `product.vaults`.

Empfohlene enge Lösung:

- `product.vaults` bleibt für die eigenständige Vault-Verwaltung Pro-gebunden.
- Grid-spezifische Provisionierungs-/Reserve-/Funding-Aktionen werden unter Grid-Routen gekapselt und mit `product.grid_bots`, Ownership, konkreter Grid-Instance/BotVault-Beziehung und zulässigem Provisionierungsstatus autorisiert.
- Free nutzt mindestens Paper beziehungsweise den vorhandenen Wallet-direct-Grid-Pfad vollständig.
- FundingVault- und wiederverwendbare Vault-Auswahl dürfen für Free verborgen/gesperrt bleiben, sofern sie nicht für den funktionierenden Basis-Grid-Pfad nötig sind.
- Der Grid-Katalog darf optionale Vault-Metadaten nicht zum Ladeblocker machen.
- Tests müssen Create → Start → Running → Pause → Resume → Stop für Free abdecken, nicht nur Navigation oder Template-Reads.

### 4.6 Prediction Slots

Die vorhandene Trennung ist grundsätzlich geeignet:

- AI und Composite besitzen getrennte Quota-Felder und Add-ons.
- Usage zählt nur `autoScheduleEnabled = true` und `autoSchedulePaused = false`.
- Manuelle One-off-Analyse muss weiterhin nur Credits verbrauchen.
- Prediction Copier wird als Bot gezählt und nicht als Prediction Schedule.

Erforderlich:

- Free-Fallbacks explizit 0 statt `null`,
- Premium 10/5,
- Plan-Capability und Credit-Balance entkoppeln,
- alle Create/Enable/Resume-Pfade für Schedules gegen denselben Quota-Service prüfen,
- Parallelaktivierungen pro User/Bucket serialisieren,
- bestehende überzählige Schedules bei Downgrade nicht löschen; Resume/Neuaktivierung blockieren und Manage/Disable erlauben.

### 4.7 Exchange-Account-Quota

Verifiziert:

- Der einzige normale Erstellpfad ist `POST /exchange-accounts`.
- Er prüft Venue und Paper-Capability, aber keine Account-Anzahl.
- Update, Read und Delete sind getrennte Pfade und können bei einem Over-limit-Nutzer weiter erlaubt bleiben.
- Ein Paper Account ist eine zusätzliche `ExchangeAccount`-Row und verlangt einen verknüpften Market-Data-Account.

Empfohlene Zählregel:

- Gezählt werden verbundene, credential-tragende reale Exchange Accounts.
- Intern erzeugte `exchange = paper`-Rows werden nicht gegen `maxExchangeAccounts` gezählt.
- Begründung: Paper Trading ist in Free enthalten, benötigt im aktuellen Modell aber bereits einen echten Market-Data-Account. Das Mitzählen der Paper-Row würde das freigegebene Free-Produktmodell widersprüchlich machen.

Produktentscheidung vom 2026-08-25: Mario hat diese Zählregel für Stage 2 freigegeben. Paper-Accounts werden nicht gegen `maxExchangeAccounts` gezählt; nur reale credential-tragende Exchange Accounts verbrauchen einen Slot.

Enforcement:

- zentraler `canCreateExchangeAccount()`-Service,
- serverseitig auf Create und alle künftigen Import-/Link-Pfade,
- Count und Create unter User-Sperre/serialisierbarer Transaktion,
- bestehende Over-limit-Free-Accounts bleiben les-, test-, aktualisier- und löschbar,
- kein automatisches Löschen oder Deaktivieren.

### 4.8 AI, Market Intelligence und Position Copilot

| Fläche | Ist-Zustand | Ziel |
| --- | --- | --- |
| AI Predictions | Breites `product.ai_predictions`-Gate | Pro; Preview für Free getrennt von ausführbarer Analyse. |
| AI Prediction Builder | Teilt sich das breite AI-Prediction-Gate | Eigenes `product.ai_prediction_builder`, Minimum Pro. |
| Market Intelligence | User-Routen sind nur auth-geschützt; Navigation folgt Calendar-Visibility | Preview/Teaser Free, Full `product.market_intelligence` ab Pro. |
| Advanced Market Intelligence | Nicht separat ausdrückbar | `product.market_intelligence_advanced`, Minimum Premium. |
| Agent Chat | Serverseitige Capability-/ENV-Policy vorhanden | `product.ai_agent_chat` ab Pro. |
| Market Analyst | Public-data Built-in-Profil | Pro. |
| Agent Account Reads | Pro derzeit standardmäßig erlaubt | `product.ai_agent_account_reads` erst Premium plus bestehendes ENV-Gate. |
| Custom Agent Profiles | Pro derzeit standardmäßig erlaubt | `product.ai_agent_custom_profiles` erst Premium plus Operator-Gate. |
| Agent Position-Copilot-Profil | Account-read-Profil | Premium plus Account-read-Gate. |
| Trade-Desk Position Copilot | Separater auth-only-Endpunkt | Eigenes `product.ai_position_copilot`, Minimum Premium, auf Settings/Analyze. |
| Position Monitoring | Kein eigener Plan-Key | `product.ai_position_monitoring`, Premium plus eigener Runtime-Flag. |
| Multi-Exchange Private Analysis | Kein eigener Plan-Key | `product.ai_multi_exchange_analysis`, Premium plus Account Ownership. |

Die vorhandene Agent-Tool-Registry ist read-only und weist Side-Effect-Skills zurück. Diese Sicherheitsregel bleibt unverändert. Plan-Zugang und verfügbare AI Credits müssen als zwei unabhängige Prüfungen vor jedem kostenpflichtigen Lauf bestehen bleiben.

### 4.9 API-Entitlement-Vertrag

`GET /settings/subscription` liefert bereits Plan, Capabilities, Feature-Gates, Limits, Usage, Credits, Pakete und Orders. Es fehlen oder sind unvollständig:

- Premium und Plan-Anzeigename,
- generisches Plan-/Term-Ende,
- Base-, Add-on- und Effective-Quota getrennt,
- Exchange-Account-Limit und Usage,
- neue fein granulare Feature-Gates,
- sicherer Zustand bei nicht verfügbarer Entitlement-Auflösung.

Additive Zielstruktur, unter Beibehaltung der Legacy-Felder während der Übergangszeit:

```ts
{
  plan: "free" | "pro" | "premium";
  planDisplayName: string;
  planValidUntil: string | null;
  entitlementsAvailable: boolean;
  capabilities: Record<CapabilityKey, boolean>;
  featureGates: Record<ProductFeatureKey, ProductFeatureGate>;
  quotas: {
    bots: { base: number; addOn: number; effective: number; used: number };
    predictionsAi: { base: number; addOn: number; effective: number; used: number };
    predictionsComposite: { base: number; addOn: number; effective: number; used: number };
    exchangeAccounts: { base: number | null; effective: number | null; used: number };
  };
  ai: {
    monthlyIncludedCredits: string;
    availableCreditBalance: string;
  };
}
```

`limits`, `usage` und `proValidUntil` bleiben zunächst als deprecated kompatible Aliasse erhalten. Bei nicht verfügbarer Entitlement-Auflösung dürfen UI-Aktionen nicht über erfundene Unlimited-Werte freigeschaltet werden.

### 4.10 Frontend und Admin

Verifizierte Touchpoints:

- `apps/web/src/billing/subscriptionViewModel.ts` kennt nur Free/Pro und filtert Bestellpläne ausschließlich auf Pro.
- Subscription-Seite rendert jeden Nicht-Pro-Plan als Free.
- Checkout erlaubt Add-ons nur bei aktuellem Pro oder ausgewähltem Plan.
- Admin Billing Schema, Draft-Typen und Select kennen nur Free/Pro.
- DE/EN-i18n besitzt Planlabels nur für Free/Pro.
- Sidebar/Header konsumieren zwar serverseitige `featureGates`, der Web-Helper defaultet fehlende Gates aber auf erlaubt.
- Market Intelligence ist nicht plan-gated.
- AI Builder teilt sich das AI-Predictions-Gate.
- Position Copilot im Trading Desk ist immer sichtbar und ruft einen auth-only-Endpunkt auf.
- Grid- und Vault-Sichtbarkeit sind getrennt, der Katalog hängt technisch dennoch vom Vault-Gate ab.
- Exchange-Account-Settings zeigen kein Count-Limit und blockieren den zweiten Free-Account nicht.

Stage 5 muss die vorhandene uLiquid-Designsprache und den UI-Skill verwenden. Stage 0 enthält bewusst keine UI-Änderung.

## 5. Enterprise-Kompatibilitätsplan

### Verifiziert

- Enterprise ist im Core-, API-, Runner- und Plugin-Policy-Typraum aktiv vorhanden.
- Enterprise besitzt mindestens eine spezifische Regel, `maxCompositeNodes = 64`.
- `LicenseEntitlement.plan` kann Enterprise persistent speichern.
- Das kommerzielle Prisma-Enum kann Enterprise derzeit nicht speichern.

### Unbekannt

- Anzahl und Identität aktiver Production-Enterprise-Entitlements.
- Ob externe/operatorseitige Prozesse weitere Enterprise-Strings oder eigene Limits schreiben.
- Ob gespeicherte Plugin-Policy-Snapshots mit Enterprise in laufenden Bots existieren.

### Verbindliche Kompatibilitätsregeln

1. Enterprise wird nicht entfernt, umbenannt, als Premium interpretiert oder öffentlich kaufbar gemacht.
2. Core-Rang: `enterprise` oberhalb `premium`.
3. Enterprise erbt neue Premium-Produktcapabilities, sofern ein bestehender expliziter Override sie nicht deaktiviert.
4. Strategy-Limits und explizite DB-Overrides, insbesondere 64 Composite Nodes, bleiben erhalten.
5. Billing-Lifecycle-Sync darf eine explizite Enterprise-Row nicht überschreiben.
6. Alte Bot-/Plugin-Capability-Snapshots bleiben lesbar. Neue Premium-Snapshots benötigen Parser-Support in API und Runner.
7. Retirement von Enterprise bleibt eine separate Migration mit eigener Daten-Evidence und Freigabe.

## 6. Additiver Migrations- und Rollout-Plan

Keine der folgenden Aktionen ist durch Stage 0 freigegeben.

### Gate A – Read-only Daten-Census und Backup-Evidence

Vor der ersten Migration:

- DB-Backup und Restore-Probe für die Zielumgebung dokumentieren.
- Aggregierten Census aus Abschnitt 7 ausführen.
- Unbekannte Plan-/Snapshot-Werte klären.
- Enterprise-Rows und spezielle Strategy-Overrides klassifizieren.
- Aktive/grace/scheduled Pro-Termine und termgebundene Add-ons quantifizieren.
- Free-Nutzer mit mehr als einem realen Account sowie Nutzer über künftigen Bot-/Schedule-Limits quantifizieren.

### Migration A – Expand-only Schema

Additiv, ohne Premium-Rows anzulegen:

1. `PREMIUM` zum PostgreSQL-/Prisma-Enum `EffectivePlan` hinzufügen.
2. `max_exchange_accounts INTEGER NULL` auf `billing_packages` und `user_subscriptions` ergänzen.
3. `plan EffectivePlan NULL` auf `subscription_terms` ergänzen.
4. `plan_valid_until TIMESTAMP NULL` auf `user_subscriptions` ergänzen und aus `pro_valid_until` backfillen.
5. Neuen Index auf `(effective_plan, plan_valid_until)` ergänzen; alten Index zunächst behalten.
6. Optional Non-negative-Checks als `NOT VALID` hinzufügen und erst nach Datenprüfung validieren.

Wichtig: Nach Enum-Erweiterung dürfen noch keine `PREMIUM`-Werte geschrieben werden, solange alter API-Code laufen könnte.

### Stage 1 – Plan- und Entitlement-Foundation

- `CommercialBillingPlan` und `CapabilityPlanTier` typisieren.
- Premium in Core, API, Runner, Plugin SDK, Snapshots und Web-Typen aufnehmen.
- Alle Unknown-Normalisierungen fail-safe machen.
- Einen zentralen `ResolvedEntitlementContext` einführen, der Billing-Plan, Enterprise-Override, Capabilities, Quotas und Usage gemeinsam liefert.
- Credit-Balance/Promo-Grant von Capability-Auflösung entkoppeln.
- Enterprise-Schutz im Workspace-Sync implementieren.
- `SubscriptionTerm.plan` dual-read aus Spalte und Legacy-Snapshot; Legacy unbekannt niemals auf Pro heben.
- `planValidUntil` additiv aus Term/Legacy liefern; `proValidUntil` vorerst kompatibel behalten.

### Stage 2 – Quotas und Free-Automation

- Zentralen aktiven Bot-Statushelper und serialisierten Admission-Service implementieren.
- Normal Bot, Grid Start/Resume und Prediction Copier darauf umstellen.
- Prediction-Schedule-Aktivierung/Resume pro Bucket serialisieren.
- `maxExchangeAccounts` mit der freigegebenen Paper-Zählregel durchsetzen.
- Free Grid end-to-end entkoppeln: optionale Vault-Reads resilient, Grid-spezifische Provisionierungsrouten eng autorisiert.
- Bestehende Over-limit-Daten weder löschen noch hart stoppen.

### Stage 3 – AI-/Capability-Gates

- Neue enge Capabilities ergänzen:
  - `product.market_intelligence`
  - `product.ai_prediction_builder`
  - `product.ai_position_copilot`
  - `product.ai_position_monitoring`
  - `product.ai_multi_exchange_analysis`
  - `product.market_intelligence_advanced`
- Free: Grid/Prediction Copier/erforderliche Execution-Plugins freischalten.
- Pro: Full Market Intelligence, AI Predictions/Builder, Agent Chat Market Analyst.
- Premium: Account Reads, Position Copilot, Monitoring, Multi-Exchange Private Analysis, Advanced MI, Custom Profiles.
- Direkten Position-Copilot und alle Profile serverseitig prüfen.
- Environment-/Operator-Master-Gates und read-only Tool-Policy unverändert darüberlegen.

### Stage 4 – Canonical Packages und kontrollierter Daten-Backfill

Erst nach Deployment eines Premium-kompatiblen Codes:

1. Canonical Packages idempotent reconciliieren:
   - `free`: 0/2/0/0/0 Credits/1 Account,
   - `pro_monthly`: $29/5/3/2/10k/Unlimited,
   - `premium_monthly`: $69/15/10/5/30k/Unlimited,
   - Capacity-Add-ons weiterhin $5,
   - AI-Topups unverändert.
2. Free-Subscription-Snapshots auf neue Basislimits und 0 monatliche Credits setzen, ohne vorhandene Credit-Balance zu reduzieren.
3. Aktive Pro-Subscriptions auf 5/3/2/10k/Unlimited setzen.
4. Aktive, Grace- und Scheduled-Pro-Term-Snapshots einmalig, versioniert und auditierbar auf das neue Pro-Basismodell heben; Termine, Orders, Add-on-Lines und Grant-Zyklen unverändert lassen.
5. `SubscriptionTerm.plan` anhand eines streng validierten Snapshots/Plan-Pakets backfillen; unklare Rows in Quarantäne/Review statt Default-Pro.
6. `planValidUntil` dual schreiben; `proValidUntil` nicht löschen.
7. Legacy Capacity-Grants nicht pauschal umschreiben. Resolver-Kompatibilität testen und nur eindeutig term-/ordergebundene Rows bei Bedarf normalisieren.
8. AI Ledger, Reservations, Orders, Payment-Evidence und historische Package-Snapshots nicht zurücksetzen oder umschreiben.

Der Backfill muss einen Dry-run, Vorher-/Nachher-Aggregate, idempotente Wiederholung und eine Review-Liste für nicht klassifizierbare Rows liefern.

### Stage 5 – Frontend, Admin und Dokumentation

- Pricing-/Subscription-Ansicht Free/Pro/Premium.
- Servergelieferte Anzeigenamen, Quotas, Base/Add-on/Effective und Usage anzeigen.
- CTA zwischen Pro und Premium unterscheiden.
- Locked AI-Flächen als nicht ausführbare Teaser/Upgrade-Flächen darstellen.
- Free Grid/Prediction Copier ohne Pro-Upsell und mit funktionierendem Flow.
- Exchange-Account-Usage und Free-Limit anzeigen.
- Admin Billing und i18n um Premium/Account-Count ergänzen.
- `docs/license-gating-matrix.md` erst jetzt auf tatsächlich ausgeliefertes Verhalten aktualisieren.
- Agent-Chat-, Billing-/AI-Credit- und Nutzer-Dokumentation aktualisieren.

### Gate B – Staging Migration und Evidence

Separate Freigabe erforderlich:

- Expand-Migration auf isolierter Staging-Kopie,
- Dry-run und Backfill,
- alle Tests aus Abschnitt 8,
- Reload-/Restart- und Lifecycle-Evidence,
- Premium-Checkout nur mit Test-/Staging-Zahlungsmittel,
- kein Production-Enablement.

### Gate C – Production

Separate ausdrückliche Freigabe nach Staging-Evidence. Reihenfolge:

1. Backup/Restore-Evidence aktuell bestätigen.
2. Expand-Migration anwenden, noch keine Premium-Werte schreiben.
3. Premium-kompatiblen API-/Runner-/Web-Code deployen, Feature-Enablement aus.
4. Daten-Census erneut prüfen und Backfill ausführen.
5. Read-only Smokes und Invarianten prüfen.
6. Premium-Paket/Checkout und UI separat aktivieren.
7. Lifecycle, AI-Grant-Idempotenz, Capability-Denials und Quota-Events beobachten.

### Rollback

- PostgreSQL-Enumwerte werden nicht destruktiv entfernt.
- Solange keine `PREMIUM`-Rows existieren, ist ein Code-Rollback auf den vorherigen Stand möglich.
- Sobald Premium-Pakete, Terms oder Subscriptions geschrieben wurden, darf alter Free/Pro-only-Code nicht wieder ausgerollt werden. Dann gilt Forward-fix beziehungsweise eine kompatible vorherige Release-Version.
- Premium-Paket kann deaktiviert und Checkout gesperrt werden; bestehende Premium-Termine dürfen nicht still zu Pro umgedeutet werden.
- Kein automatischer Credit-Abzug, kein Order-/Ledger-Reset und keine Account-/Bot-Löschung als Rollback.

## 7. Read-only Daten-Census vor Migration

Die folgenden Queries sind ein Plan, kein in Stage 0 ausgeführter Datenbankzugriff. Sie liefern nur Aggregate und sollten erst nach separater Freigabe gegen die Zielumgebung laufen.

```sql
-- Tatsächliche Enumwerte
SELECT e.enumlabel
FROM pg_type t
JOIN pg_enum e ON e.enumtypid = t.oid
WHERE t.typname = 'EffectivePlan'
ORDER BY e.enumsortorder;

-- Subscription-Verteilung und aktuelle Basiswerte
SELECT effective_plan::text, status::text,
       max_running_bots,
       max_running_predictions_ai,
       max_running_predictions_composite,
       monthly_ai_credits_included,
       COUNT(*)
FROM user_subscriptions
GROUP BY 1,2,3,4,5,6
ORDER BY 1,2,3,4,5,6;

-- Pakete und Canonical Codes
SELECT code, kind::text, plan::text, is_active, price_cents,
       max_running_bots,
       max_running_predictions_ai,
       max_running_predictions_composite,
       monthly_ai_credits,
       delta_running_bots,
       delta_running_predictions_ai,
       delta_running_predictions_composite
FROM billing_packages
ORDER BY sort_order, code;

-- Strategy-/Enterprise-Werte
SELECT lower(trim(plan)) AS plan, max_composite_nodes,
       allowed_strategy_kinds, ai_allowed_models, COUNT(*)
FROM license_entitlements
GROUP BY 1,2,3,4
ORDER BY 1,2;

-- Term-Snapshot-Pläne und Phasen
SELECT status::text,
       COALESCE(entitlement_snapshot->>'plan', '<missing>') AS snapshot_plan,
       COUNT(*)
FROM subscription_terms
GROUP BY 1,2
ORDER BY 1,2;

-- Order-Snapshot-Pläne; historische Snapshots nur lesen
SELECT COALESCE(package_snapshot->>'plan', '<missing>') AS snapshot_plan,
       kind_snapshot::text,
       COUNT(*)
FROM billing_order_items
GROUP BY 1,2
ORDER BY 1,2;

-- Capacity-Grant-Bindung und Scope
SELECT COALESCE(plan_scope::text, '<none>') AS plan_scope,
       (term_id IS NOT NULL) AS term_bound,
       (order_id IS NOT NULL) AS order_bound,
       (valid_until IS NULL) AS unbounded,
       COUNT(*)
FROM subscription_capacity_grants
GROUP BY 1,2,3,4
ORDER BY 1,2,3,4;

-- Reale und Paper-Accounts getrennt, ohne Accountdetails auszugeben
WITH account_usage AS (
  SELECT user_id,
         COUNT(*) FILTER (WHERE lower(exchange) <> 'paper') AS real_accounts,
         COUNT(*) FILTER (WHERE lower(exchange) = 'paper') AS paper_accounts
  FROM exchange_accounts
  GROUP BY user_id
)
SELECT s.effective_plan::text,
       a.real_accounts,
       a.paper_accounts,
       COUNT(*) AS users
FROM account_usage a
LEFT JOIN user_subscriptions s ON s.user_id = a.user_id
GROUP BY 1,2,3
ORDER BY 1,2,3;

-- Aktive Bot-Nutzung je aktuellem Plan
WITH bot_usage AS (
  SELECT user_id, COUNT(*) AS running_bots
  FROM bots
  WHERE status = 'running'
  GROUP BY user_id
)
SELECT s.effective_plan::text, b.running_bots, COUNT(*) AS users
FROM bot_usage b
LEFT JOIN user_subscriptions s ON s.user_id = b.user_id
GROUP BY 1,2
ORDER BY 1,2;

-- Ledger-/Reservation-Invarianten als Aggregate
SELECT reason::text, COUNT(*), SUM(delta_credits)
FROM ai_credit_ledger
GROUP BY 1
ORDER BY 1;

SELECT status::text, COUNT(*), SUM(reserved_credits), SUM(settled_credits)
FROM ai_credit_reservations
GROUP BY 1
ORDER BY 1;
```

Vor dem Backfill müssen zusätzlich anwendungsspezifische Invarianten gegen Term/Order/Grant-Beziehungen laufen. Personenbezogene Detaildaten gehören nur in einen geschützten Review-Pfad, nicht in Repo-Dokumentation oder Logs.

## 8. Testplan

### 8.1 Core und Plan-Normalisierung

- Rang exakt Free < Pro < Premium < Enterprise.
- Unknown/`null`/Großschreibung/Legacy-Müll normalisiert nie auf einen bezahlten Plan.
- `requiredPlanForCapability()` für jede neue Capability.
- Enterprise erbt Premium, bewahrt aber 64 Composite Nodes und explizite Overrides.
- Alte Free/Pro/Enterprise- und neue Premium-Plugin-Snapshots werden in API und Runner gelesen.
- Capability-Override-Key `plan.capabilities.override.v1:premium` funktioniert; fehlender Override bleibt Default.

### 8.2 Migration und Datenkompatibilität

- Vor-Migrations-Fixture mit Free, aktivem Pro, Grace-Pro, Scheduled-Pro, Enterprise-License, AI-Ledger, offenen/paid Orders und termgebundenen Add-ons.
- Expand-Migration lässt alten Code lesefähig, solange keine Premium-Row existiert.
- Backfill ist zweimal ausführbar und beim zweiten Lauf ein No-op.
- Pro-Termine behalten Start/End/Grace, Order-Verknüpfung und Add-on-Lines.
- Credit-Balance, Reserved/Settled-Beträge, Ledger-Anzahl und Idempotency Keys bleiben unverändert.
- Historische Order-Item-Snapshots bleiben byte-/JSON-semantisch unverändert.
- Unbekannter Term-Plan landet in Review und nicht als Pro/Premium.
- Enterprise-Row wird durch Billing-Sync nicht überschrieben.

### 8.3 Quotas

- Bot-Basis 2/5/15 und Add-on nur im Bot-Bucket.
- AI-Schedule 0/3/10 und Add-on nur im AI-Bucket.
- Composite 0/2/5 und Add-on nur im Composite-Bucket.
- Abgelaufene/abgeschnittene Grants tragen 0 bei.
- Trading Bot, Grid und Prediction Copier teilen denselben Running-Count.
- Draft, created, stopped, paused, archived und error zählen nicht; running zählt exakt 1.
- Zwei parallele Starts bei einem freien Slot: genau einer erfolgreich.
- Over-limit nach Downgrade bleibt manage-/stoppbar, neuer Start wird abgelehnt.

### 8.4 Grid und Prediction Copier End-to-End

- Free Grid-Katalog lädt auch bei verweigerter eigenständiger Vault-Capability.
- Free Paper Grid: Create → Start → Running → Pause → Resume → Stop.
- Free Wallet-direct Grid-Provisionierung nutzt nur eng autorisierte Grid-Routen.
- Free kann keine allgemeine Vault-Verwaltung öffnen.
- Free Prediction Copier: Create als stopped, Bestätigung, Start, Slot zählt, Stop gibt Slot frei.
- Runner akzeptiert den Free-Plugin-Policy-Snapshot für Grid/Prediction Copier.
- Stale Pro-Upsell-Copy und Pro-only-Navigation sind entfernt.

### 8.5 Exchange Accounts

- Free kann den ersten realen Account erstellen.
- Free kann keinen zweiten realen Account erstellen.
- Free kann zum einen realen Account einen Paper Account anlegen, falls die empfohlene Zählregel freigegeben wird.
- Pro/Premium dürfen zusätzliche Accounts erstellen; technischer Fair-Use-Cap bleibt getrennt.
- Zwei parallele Free-Create-Requests erzeugen höchstens einen Account.
- Migrierter Over-limit-Free-Nutzer kann lesen, testen, aktualisieren und entfernen, aber nicht neu erstellen.

### 8.6 Billing und ULIQ

- Pakete exakt Free $0, Pro $29/10k, Premium $69/30k.
- Capacity-Add-ons exakt $5 und für Pro/Premium, nicht Free.
- AI-Topups unverändert.
- Premium-Term aktiviert korrekte Basiswerte und idempotente 30k-Monatszyklen.
- Planwechsel bewahrt Orders, Ledger, Grants und Termfenster.
- Pro→Premium während aktivem Term folgt der vor Stage 4 freigegebenen Aktivierungsregel.
- Capacity-only-Warenkorb erhält keinen ULIQ-Rabatt.
- Gemischter Plan+Capacity-Warenkorb rabattiert nur die rabattfähige Subscription-Line.
- AI-Credit-only-Warenkorb verwendet weiterhin AI-Credit-Discount.
- ULIQ-Tier und Discount kommen ausschließlich aus der Backend-Reservation.

### 8.7 AI-Security

- Free Agent Chat denied.
- Pro Market Analyst/public-market tools allowed.
- Pro Account Reads, Agent Position Copilot, Trade-Desk Position Copilot, Monitoring und Multi-Exchange Private Analysis denied.
- Premium erhält diese Features nur bei aktivem jeweiligem ENV-/Operator-Gate.
- Direkter Aufruf aller Premium-Endpunkte kann das Profilgate nicht umgehen.
- Ownership-Prüfung verhindert fremde Exchange-Account-IDs.
- Credit-Erschöpfung blockiert einen erlaubten AI-Lauf.
- Kein Profil und kein Tool kann Trades ausführen; Trade-Draft-Gate bleibt geschlossen.

### 8.8 API und Frontend

- Entitlement-Payload enthält Planname, Capabilities, Feature-Gates, Base/Add-on/Effective/Usage und Account-Quota.
- Legacy-Felder bleiben während Übergang kompatibel.
- Unavailable-Entitlements ergeben keine klickbare Paid-Aktion.
- Pricing Cards, Upgrade-to-Pro/Premium und Planwechsel-Aktivierungsdatum korrekt.
- Quota-Anzeige zum Beispiel `3 / 5`, Add-on-Anteil separat.
- Locked AI-Flächen bleiben als nicht ausführbare Teaser sichtbar.
- Admin kann Premium-Pakete und `maxExchangeAccounts` korrekt verwalten.
- DE/EN-i18n vollständig; `npm -w apps/web run i18n:check` grün.

### 8.9 Vorgesehene Checks

Nach Implementierung, noch vor Staging:

```bash
npm run db:generate
npm -w packages/core run typecheck
node node_modules/tsx/dist/cli.mjs --test packages/core/src/capabilities/*.test.ts
npm -w apps/api run typecheck
npm -w apps/api run test:billing
npm -w apps/api run test:agent-chat
npm -w apps/api run test:ai
npm -w apps/api run test:grid-corewriter
npm -w apps/api run test:vaults
node node_modules/tsx/dist/cli.mjs --test apps/api/src/exchange-accounts/routes.test.ts apps/api/src/position-copilot/routes.test.ts apps/api/src/license.test.ts
npm -w apps/runner run typecheck
npm -w apps/runner run test
npm -w apps/web run typecheck
npm -w apps/web run test:billing
npm -w apps/web run test:grid-catalog
npm -w apps/web run test:agent-chat-ui
npm -w apps/web run i18n:check
npm run quality:any-budget
npm run quality:vendor-charting
git diff --check
```

Zusätzlich ist ein eigener Migrationstest gegen eine temporäre PostgreSQL-Datenbank erforderlich; Typechecks und Unit-Tests ersetzen diesen nicht.

## 9. Offene Entscheidungen vor Stage 1/2

| Entscheidung | Empfehlung | Status |
| --- | --- | --- |
| Zählt Paper gegen das Free-Account-Limit? | Nein; nur reale credential-tragende Accounts zählen. | Freigegeben am 2026-08-25. |
| Pro→Premium während aktivem Pro-Term | Bestehende Logik beibehalten: Premium startet am Termende; UI zeigt Datum. Sofortupgrade/Proration ist separate Billing-Arbeit. | Offen, Produktfreigabe erforderlich. |
| Umfang Free Market-Intelligence-/AI-Preview | Separates, serverseitig begrenztes Preview-Payload ohne ausführbare/kostenpflichtige Aktion. | Offen, UX-Inhalt erforderlich. |
| Production-Enterprise-Bestand | Enterprise beibehalten und schützen; Census vor Migration. | Unbekannt bis Read-only Census. |
| Technischer Paid-Account-Fair-Use-Cap | Separates internes Safety-Limit, nicht im kommerziellen Payload als Planlimit anzeigen. | Offen; kein Blocker für `null`-Entitlement. |

## 10. Definition of Done für Stage 0

- [x] Task-Markdown vollständig ausgewertet.
- [x] Pricing-PDF vollständig über alle fünf Seiten visuell geprüft.
- [x] Plan-, Billing-, Term-, Order-, Add-on-, Credit- und Prisma-Modelle inventarisiert.
- [x] Alle Enterprise-Codepfade und spezifischen Regeln inventarisiert.
- [x] Bot/Grid/Prediction-Copier-Status- und Startpfade geprüft.
- [x] Grid→Vault-Abhängigkeiten geprüft.
- [x] Exchange-Account-Create/Update/Delete und Paper-Modell geprüft.
- [x] AI/Agent Chat/Position Copilot/Market Intelligence geprüft.
- [x] Web-, Admin-, i18n- und API-Contract-Touchpoints geprüft.
- [x] Additiver Migrations-, Rollout-, Rollback- und Testplan erstellt.
- [ ] Production-/Staging-Daten-Census – unbekannt, benötigt separate Zugriffsfreigabe.
- [ ] Migration – nicht freigegeben und nicht ausgeführt.
- [ ] Deployment – nicht freigegeben und nicht ausgeführt.
