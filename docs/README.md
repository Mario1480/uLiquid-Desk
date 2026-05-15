---
description: User-Dokumentation und Knowledge Base fuer uLiquid Desk.
icon: book-open
---

# uLiquid Desk Knowledge Base

Willkommen in der uLiquid Desk Dokumentation. Diese Knowledge Base erklaert die wichtigsten Workflows fuer Dashboard, Exchange-Accounts, manuelles Trading, Prognosen, Bots, Grid Bots, Wallet, Funding, Vaults, Admin-Funktionen und Support.

{% hint style="warning" %}
uLiquid Desk ist ein Trading- und Automatisierungswerkzeug. Pruefe jede Order, jedes Funding und jede Bot-Konfiguration selbst. Diese Dokumentation ist keine Finanzberatung.
{% endhint %}

## Schnell starten

1. Account erstellen oder einloggen.
2. Workspace und Rolle pruefen.
3. Exchange-Account oder Wallet verbinden.
4. Erst im Paper-/Testmodus pruefen.
5. Danach einzelne Live-Flows mit kleinen Limits testen.

## Bereiche

<table data-view="cards">
  <thead>
    <tr>
      <th>Bereich</th>
      <th>Wofuer du ihn nutzt</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td><a href="getting-started/quickstart.md">Erste Schritte</a></td>
      <td>Setup-Reihenfolge, Login, Rollen, Sicherheitsgrundlagen.</td>
    </tr>
    <tr>
      <td><a href="user-guide/dashboard-and-accounts.md">Dashboard & Accounts</a></td>
      <td>Kontostatus, offene Positionen, Alerts und Exchange-Accounts.</td>
    </tr>
    <tr>
      <td><a href="user-guide/trading-desk-and-risk.md">Trading Desk & Risiko</a></td>
      <td>Manuelle Orders, Positionen, Guardrails und Notfallverhalten.</td>
    </tr>
    <tr>
      <td><a href="user-guide/signals-and-automation.md">Signale & Automatisierung</a></td>
      <td>Prognosen, Strategien, normale Bots und Grid Bots.</td>
    </tr>
    <tr>
      <td><a href="user-guide/wallet-funding-and-vaults.md">Wallet, Funding & Vaults</a></td>
      <td>Wallet verbinden, Hyperliquid Transfers, Funding Vaults und BotVaults.</td>
    </tr>
    <tr>
      <td><a href="support/troubleshooting-and-faq.md">Support & FAQ</a></td>
      <td>Fehlerbilder, Diagnoseinfos und haeufige Fragen.</td>
    </tr>
  </tbody>
</table>

## Gute Arbeitsweise

- Nutze fuer neue Setups zuerst Paper- oder Canary-Flows.
- Aendere nur eine kritische Einstellung auf einmal.
- Halte Screenshots, Uhrzeit, Workspace, Account und Bot-/Grid-ID fuer Supportfaelle bereit.
- Starte Live-Bots nur, wenn Accountdaten, Margin, Funding und Berechtigungen sicher angezeigt werden.
- Verwende fuer Exchange-API-Keys keine Withdrawal-Rechte.

## GitBook und GitHub

Diese Doku ist fuer GitBook Git Sync vorbereitet. GitBook nutzt `docs/README.md` als Startseite, `docs/SUMMARY.md` als Navigation und `.gitbook.yaml` im Repo-Root als Sync-Konfiguration.
