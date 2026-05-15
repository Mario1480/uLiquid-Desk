---
description: Der schnellste Weg vom ersten Login bis zum kontrollierten Testlauf.
icon: rocket
---

# Schnellstart

Dieser Ablauf ist fuer neue Nutzer und Operator gedacht, die uLiquid Desk sicher einrichten und zuerst kontrolliert testen moechten.

## 1. Account und Workspace pruefen

Melde dich an und pruefe oben rechts deinen User. Falls du mehrere Workspaces nutzt, stelle sicher, dass du im richtigen Workspace arbeitest.

{% hint style="info" %}
Viele Aktionen sind rollenbasiert. Wenn ein Menuepunkt fehlt oder ein Button deaktiviert ist, fehlen dir wahrscheinlich Berechtigungen fuer diesen Workspace.
{% endhint %}

## 2. Sicherheitssetup abschliessen

- Verifiziere deine E-Mail, falls erforderlich.
- Richte OTP/Re-Auth ein, wenn sensible Aktionen dies verlangen.
- Nutze fuer Admin- oder Trading-Rollen ein starkes Passwort.
- Teile keine Session und keine Exchange-API-Keys.

## 3. Exchange-Account oder Wallet verbinden

Fuer manuelles Trading, Bots und Prognosen brauchst du in der Regel einen Exchange-Account. Fuer Funding, BotVaults und onchain Aktionen brauchst du eine Wallet.

Empfohlene Reihenfolge:

1. Exchange-Account in den Einstellungen anlegen.
2. Account-Sync im Dashboard pruefen.
3. Wallet verbinden, falls du Funding- oder Vault-Flows nutzt.
4. HyperEVM-Netzwerkstatus pruefen.

## 4. Read-only Sicht pruefen

Oeffne das Dashboard und pruefe:

- Exchange-Accounts sind verbunden.
- Equity, Margin und PnL werden plausibel angezeigt.
- Offene Positionen erscheinen korrekt.
- Alerts sind leer oder nachvollziehbar.
- Calendar, News und Prognosen laden ohne Fehler.

## 5. Erst Paper, dann Canary

Bevor du Live-Kapital einsetzt:

- Starte einen Paper-/Demo-Flow.
- Pruefe Order Submit, Cancel, Close und Refresh.
- Nutze kleine Notional-Limits fuer den ersten Live-Canary.
- Fuehre keine parallelen Browser-Tabs fuer kritische Trading-Aktionen im ersten Test.

## 6. Naechste Seiten

- [Account, Login und Sicherheit](account-login-security.md)
- [Dashboard und Exchange-Accounts](../user-guide/dashboard-and-accounts.md)
- [Trading Desk und Risiko](../user-guide/trading-desk-and-risk.md)
- [Wallet, Funding und Vaults](../user-guide/wallet-funding-and-vaults.md)
