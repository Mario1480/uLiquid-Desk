---
description: Benutzer, Rollen und Berechtigungen im Workspace verwalten.
icon: user-cog
---

# Benutzer, Rollen und Berechtigungen

Rollen steuern, welche Bereiche ein User sehen und welche Aktionen er ausfuehren darf. Arbeite nach Least Privilege: Jeder User bekommt nur die Rechte, die er wirklich braucht.

## Rollen pflegen

1. Admin-Bereich oeffnen.
2. Users oder Roles waehlen.
3. User oder Rolle auswaehlen.
4. Permissions pruefen.
5. Aenderung speichern.
6. Betroffenen User testen lassen.

## Kritische Permissions

Besonders sensibel sind Rechte fuer:

- manuelle Market-Orders,
- manuelle Limit-Orders,
- Exchange-Key-Verwaltung,
- Rollen- und User-Administration,
- Billing und Lizenzen,
- Vault- und Funding-Operationen,
- Admin API Keys,
- AI Prompt- und Strategy-Konfiguration.

## Empfohlene Rollenverteilung

| Rolle | Empfehlung |
| --- | --- |
| Superadmin | Nur fuer Plattformbetreiber und Break-glass. |
| Admin | Workspace-Verantwortliche, nicht fuer jeden Operator. |
| Operator | Trading-/Bot-Betrieb ohne globale Admin-Rechte. |
| Viewer | Monitoring, Reporting und Support ohne Mutationen. |

## Nach Teamwechseln

- User entfernen oder Rolle reduzieren.
- Exchange-Keys rotieren, falls Zugriff bestand.
- API-Keys und Webhooks pruefen.
- Audit auf ungewoehnliche Aktionen pruefen.

## Permission-Probleme erkennen

Typische Anzeichen:

- Button fehlt.
- Button ist deaktiviert.
- API liefert `403 permission_required`.
- Feature erscheint nicht in der Navigation.

Pruefe dann Workspace, Rolle, Feature Gate und Ownership.
