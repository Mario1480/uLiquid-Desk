# uLiquid Desk Project Agend

Last updated: 2026-05-18

Diese Datei sammelt die aktuelle Arbeitsagenda fuer das Projekt. Die bestehende `AGENDA.md` bleibt die release- und gate-orientierte Agenda; diese `Agend.md` ist die operative Step-by-step-Uebersicht fuer die naechsten Projektbereiche.

## 1. Admin & UI Konsolidierung

- [ ] Admin-Seiten auf eine einheitliche Breite, linke Ausrichtung und konsistente Section-Struktur bringen.
- [ ] Integrated Control Areas final nach Themen sortieren: Access, AI & Prediction, Bots/Grid/Strategies, Vaults, Integrations, Notifications.
- [ ] Alte Admin-Zwischenseiten aus dem sichtbaren Flow entfernen oder auf direkte Zielseiten weiterleiten.
- [ ] Admin-Actions vollstaendig auf `AdminActionButton`, `AdminConfirmDialog`, `AdminNotice` und `AppIcon` vereinheitlichen.
- [ ] Browser-Smoke fuer `/admin`, `/admin/system`, `/admin/users`, `/admin/bots`, `/admin/system/vaults/execution`, `/admin/system/ai/prompts`.

## 2. Go-Live Operations

- [ ] Aktuelle Go-live-Dokumente gegen den realen Stand im Code abgleichen.
- [ ] Release Evidence Matrix fuer den naechsten Deploy-Tag ausfuellen.
- [ ] Docker-Production-Builds fuer API, Web, Runner und Python-Service dokumentieren.
- [ ] Staging-Migration mit Backup- und Restore-Probe als Go-live-Nachweis erfassen.
- [ ] Canary-Limits, Rollback-Rehearsal und Kill-Switch-Evidence final dokumentieren.

## 3. BotVault, Funding Vault & Onchain

- [ ] FundingVaultV1 Factory Deployment auf dem VPS dokumentieren und verifizieren.
- [ ] Funding Vault im Web vollstaendig pruefen: Create, Deposit, Launch Grid, Withdraw-to-linked-wallet.
- [ ] Agent-Wallet-HYPE-Status, Funding-Vault-Balance und reserviertes Kapital in Wallet/Dashboard konsistent anzeigen.
- [ ] Onchain-Reconciliation, Pending-States und PlatformAlerts fuer Funding-/Vault-Flows pruefen.
- [ ] Explorer-Verifikation, Ownership und Pause-/Operator-Rotation fuer neue Contracts dokumentieren.

## 4. Trading, Exchanges & Positions

- [ ] Positionsdaten exchangeuebergreifend auf Leverage, Margin, ROE, Liquidation und Liq.-Abstand pruefen.
- [ ] Trading Desk und Positions-Detailansichten auf dieselben Position-Felder vereinheitlichen.
- [ ] Symbol-Dropdowns und Exchange-Auswahl in allen Trading-Flows auf die neuen gemeinsamen UI-Komponenten bringen.
- [ ] Wallet & Funding Activity-Feeds gegen echte Funding-/Transfer-Historie verifizieren.

## 5. AI, Predictions & Strategies

- [ ] AI & Prediction Admin-Flaechen nach neuem System-Layout pruefen.
- [ ] Strategy Builder, Local Strategies, AI Strategies und AI Generator ohne zusaetzliche Landing-Page direkt erreichbar halten.
- [ ] Prediction Defaults, Refresh, Trace und Prompts als zusammenhaengenden AI-&-Prediction-Bereich final testen.
- [ ] AI-Degraded- und Provider-Smokes in Go-live-Evidence uebernehmen.

## 6. Mobile / iOS Readiness

- [ ] Funding Vault als Mobile-faehigen GridBot-Startpfad ohne MetaMask-Signatur in der iOS-App abbilden.
- [ ] iOS Positionsansicht mit erweiterten Exchange-Feldern spiegeln.
- [ ] Web-Icon- und Button-System weiter mit iOS-SF-Symbolsprache abgleichen.
- [ ] Mobile Blocked-/Top-up-/Setup-States fuer Funding Vault definieren.

## 7. Release Cadence

- [ ] Pro Arbeitsblock: Codeaenderung, Typecheck, relevante Tests, kurzer Browser-/API-Smoke, danach Commit.
- [ ] Nach jedem groesseren Block `Agend.md` und Go-live-Dokumente aktualisieren.
- [ ] Erst nach gruenem Canary-Run neue Produktfeatures ausserhalb der Go-live-Liste priorisieren.
