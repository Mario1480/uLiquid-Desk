---
description: Kontrollierte Go-live Vorbereitung, Canary und Smoke-Test Checklisten.
icon: clipboard-check
---

# Go-live und Smoke Tests

Go-live bedeutet bei uLiquid Desk nicht Big Bang. Nutze einen kontrollierten Canary mit kleinen Limits, klarer Beobachtung und einem Rollback-Pfad.

## Vor Go-live

- Production-Secrets ausserhalb des Repos setzen.
- Datenbankmigration auf Staging testen.
- Fresh Install oder Docker-Build aus aktuellem Lockfile.
- Caddy/API/Web Routing pruefen.
- Admin- und User-Rollen testen.
- Exchange-Accounts mit echten Read-Daten pruefen.
- Wallet- und Funding-Flows mit kleinem Betrag testen.
- Monitoring und Alertwege festlegen.

## Trading Smoke

1. Accountdaten laden.
2. Symbole laden.
3. Market Data pruefen.
4. Limit Order erstellen.
5. Einzelne Order canceln.
6. Cancel All testen.
7. Kleine Position oeffnen.
8. Position schliessen.
9. Exchange UI gegen Desk UI abgleichen.

## Grid Bot Smoke

1. Template Preview berechnen.
2. Budget, Reserve und Liquidationsabstand pruefen.
3. Funding-Quelle pruefen.
4. BotVault Provisioning starten.
5. Seed und Grid Placement beobachten.
6. Runner-Status pruefen.
7. Stop/Pause testen.
8. Settlement- und Withdraw-Pfad separat pruefen.

## Wallet/Funding Smoke

- Wallet verbinden.
- HyperEVM Netzwerk wechseln.
- Arbitrum -> HyperCore Deposit.
- HyperCore -> HyperEVM Transfer.
- HyperEVM -> HyperCore Transfer.
- Spot <-> Perps Umbuchung.
- BotVault-Wallet funden.
- Funding-Historie und Pending-Status pruefen.

## Admin Smoke

- Login und E-Mail-Verifikation.
- Passwort-Reset.
- OTP/Re-Auth.
- User-Rolle ohne Admin-Rechte.
- Admin-Rolle mit erwarteten Rechten.
- SMTP-Test.
- Telegram-Test.
- Audit-Eintrag nach kritischer Aktion.

## Verwandte interne Dokumente

- [Go-live Readiness Follow-ups](../go-live-readiness-followups.md)
- [Trading Desk Go-live Status](../trading-desk-go-live-status.md)
- [Wallet & Funding Go-live Status](../wallet-funding-go-live-status.md)
- [GridBot Go-live Status](../gridbot-go-live-status.md)
- [BotVault Go-live Follow-ups](../botvault-go-live-followups.md)
- [Smoke Test](../SMOKE_TEST.md)
