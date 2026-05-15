---
description: Workspace-Konzept, Rollenmodell und wichtige Begriffe.
icon: users
---

# Workspaces, Rollen und Begriffe

## Workspaces

Ein Workspace trennt Nutzer, Exchange-Accounts, Bots, Einstellungen und Berechtigungen. Pruefe vor jeder kritischen Aktion, dass du im richtigen Workspace bist.

Typische Workspace-Inhalte:

- Mitglieder und Rollen.
- Exchange-Accounts.
- Trading- und Risiko-Einstellungen.
- Bots, Grid Bots und Prognosen.
- Billing-, Lizenz- und Affiliate-Daten.

## Rollen

Die konkrete Rollenmatrix kann pro Installation variieren. Typische Rollen sind:

- **Superadmin**: Plattformweite Administration.
- **Admin**: Workspace-Verwaltung, Rollen, Settings und kritische Konfiguration.
- **Operator**: Operative Nutzung von Trading, Bots und Monitoring.
- **Viewer**: Lesender Zugriff ohne kritische Mutationen.

{% hint style="info" %}
Wenn du eine Aktion erwartest, sie aber nicht siehst, pruefe zuerst Rolle, Workspace und Feature-Freischaltung.
{% endhint %}

## Wichtige Begriffe

| Begriff | Bedeutung |
| --- | --- |
| Exchange-Account | Server-seitig gespeicherte Exchange-Verbindung, deren Keys verschluesselt abgelegt werden. |
| Trading Desk | Manuelle Trading-Oberflaeche fuer Orders, Positionen und Live-Daten. |
| Prediction | Marktprognose oder Signal, das ein Setup beschreibt und optional den Trading Desk vorfuellt. |
| Strategy | Regel- oder AI-basierte Logik, die Setups bewertet oder Signale erzeugt. |
| Bot | Automatisierter Trading-Lauf, der eine Strategie ausfuehrt. |
| Grid Bot | Bot-Typ, der innerhalb einer Preisrange Grid-Orders verwaltet. |
| Funding Vault | Mobile-faehiger USDC-Speicher fuer agent-signierte GridBot-Starts. |
| BotVault | Kapitalbereich fuer Bot-/Grid-Ausfuehrung und Settlement. |
| Re-Auth | Erneute Bestaetigung per OTP oder Sicherheitsflow vor sensiblen Aktionen. |
| Canary | Kontrollierter Live-Test mit kleinen Limits und engem Monitoring. |
