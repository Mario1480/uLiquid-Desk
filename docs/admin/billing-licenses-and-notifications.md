---
description: Subscription, Lizenzen, Affiliate, SMTP, Telegram und Notifications.
icon: bell-ring
---

# Abrechnung, Lizenzen und Benachrichtigungen

Diese Seite fasst operative Admin-Themen zusammen, die nicht direkt Trading-Parameter sind, aber den Zugang und die Kommunikation steuern.

## Billing und Lizenzen

Im Admin- und Settings-Bereich koennen je nach Rolle sichtbar sein:

- Subscription-Status.
- Lizenzpakete.
- Feature-Freischaltungen.
- Workspace- oder User-Limits.
- Billing-relevante Audit-Eintraege.

Wenn ein Feature fehlt, pruefe zuerst Lizenz, Rolle und Bereichszugriff.

## Affiliate und Profitshare

Affiliate-Daten und Payout Wallets werden in eigenen Bereichen verwaltet. Vor Auszahlungen pruefen:

- Payout Wallet existiert.
- Wallet-Konfiguration ist korrekt.
- USDC/HYPE Balance reicht.
- Secret-Referenz ist vorhanden.
- Audit und History zeigen keine offenen Fehler.

## SMTP

SMTP ist relevant fuer E-Mails wie Verifikation, Passwort-Reset und OTP. Bei E-Mail-Problemen pruefen:

- SMTP Host, Port und Credentials.
- Absenderadresse.
- TLS/SSL-Einstellung.
- Spam-Ordner.
- Rate Limits beim Mail Provider.

## Telegram

Telegram kann fuer handelbare Signale, Alerts und Deep Links genutzt werden. Bei Problemen pruefen:

- Bot Token.
- Chat oder Channel ID.
- User-Linking.
- Deep-Link Base URL.
- Notification-Settings.

## Webhooks

Webhook-Ziele sollten HTTPS verwenden und zu vertrauenswuerdigen externen Systemen zeigen. Private, lokale oder Metadata-Adressen werden in Production blockiert.

## Alert-Hygiene

- Nur actionable Alerts aktivieren.
- Verantwortliche klar definieren.
- Testnachrichten nach Setup senden.
- Wiederholte Fehlalarme nicht ignorieren, sondern Ursache beheben.
