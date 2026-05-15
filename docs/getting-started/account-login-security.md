---
description: Login, Session, Re-Auth und sichere Account-Nutzung.
icon: shield-check
---

# Account, Login und Sicherheit

uLiquid Desk schuetzt sensible Aktionen ueber Sessions, Rollen, Re-Auth und Audit-Logs. Diese Seite beschreibt, was Nutzer im Alltag beachten sollten.

## Login

Melde dich mit deiner registrierten E-Mail und deinem Passwort an. Je nach Konfiguration muss deine E-Mail zuerst bestaetigt werden.

Bei wiederholten Fehlversuchen kann der Login temporaer begrenzt werden. Warte in diesem Fall die angezeigte Zeit ab, statt weitere Versuche zu starten.

## Re-Auth und OTP

Fuer sensible Aktionen kann uLiquid Desk eine erneute Bestaetigung verlangen. Dazu gehoeren typischerweise:

- Exchange-API-Keys anlegen oder aendern.
- Manuelle Trading-Aktionen.
- Rollen- und Berechtigungsanpassungen.
- Kritische Admin-Einstellungen.

Wenn ein OTP mehrfach falsch eingegeben wird, kann die Aktion bis zum Ablauf oder Resend gesperrt werden.

## Sichere Exchange-API-Keys

Exchange-Keys sollten nur die Rechte haben, die fuer den jeweiligen Zweck noetig sind.

{% hint style="danger" %}
Aktiviere fuer uLiquid Desk API-Keys keine Withdrawal-Rechte. Trading- und Read-Rechte reichen fuer die vorgesehenen Exchange-Flows.
{% endhint %}

Empfehlungen:

- Nutze pro Workspace oder Umgebung eigene Keys.
- Verwende IP-Whitelists, wenn deine Exchange dies unterstuetzt.
- Rotiere Keys nach Teamwechseln oder Sicherheitsvorfaellen.
- Deaktiviere nicht mehr benoetigte Keys direkt bei der Exchange.

## Wallet-Sicherheit

Wallet-Signaturen bestaetigen onchain Aktionen. Pruefe vor jeder Signatur:

- Richtige Wallet-Adresse.
- Richtiges Netzwerk.
- Richtiger Betrag.
- Erwartetes Ziel, etwa HyperEVM, HyperCore, Arbitrum oder BotVault.

## Audit und Nachvollziehbarkeit

Admin- und Security-relevante Aktionen koennen im Audit auftauchen. Bei Supportfaellen helfen Zeitstempel, User, Workspace, Aktion und betroffene Account- oder Bot-ID.
