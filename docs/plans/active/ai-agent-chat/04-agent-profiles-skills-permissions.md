# Agent 04 – Agent Profiles, Skills und Berechtigungen

## Auftrag

Implementiere eine verständliche, serverseitig erzwungene Konfiguration aus Agent Profile, aktiven Skills und Datenberechtigungen.

## Zentrale Trennung

### Skill

Welche Fähigkeit darf der Agent grundsätzlich verwenden?

Beispiele:

- Market Data
- Funding
- News
- Predictions
- Positions

### Permission

Auf welche persönlichen Daten darf diese Fähigkeit zugreifen?

Beispiele:

- kein Konto,
- ausgewähltes Konto read-only,
- mehrere freigegebene Konten read-only.

### Action Level

Welche Wirkung darf der Agent erzeugen?

- `public_data`
- `account_read`
- später `draft_actions`

Ein aktivierter Skill erhöht niemals automatisch das Action Level.

## Built-in Profiles

### Market Analyst

- Public Data only
- kein Account erforderlich
- Market, Intelligence, Predictions

### Position Copilot

- Account read erforderlich
- ausgewählte Positionen/Konten
- Market, Intelligence, Predictions, Portfolio, deterministic Risk
- kein Draft und keine Execution

### Trading Assistant – später

- Draft Actions Feature Gate
- erstellt nur persistierte Entwürfe
- separate Bestätigung

## Profilmodell

Built-in Profile werden serverseitig versioniert und sind nicht löschbar. Nutzerprofile referenzieren ein Base Profile und speichern Overrides.

```ts
type AgentProfileConfig = {
  name: string;
  baseProfileKey: "market_analyst" | "position_copilot" | "trading_assistant";
  enabledSkillIds: string[];
  allowedExchangeAccountIds: string[];
  preferredVenue: string | "auto";
  preferredMarketType: "spot" | "perp" | null;
  actionLevel: "public_data" | "account_read" | "draft_actions";
};
```

## Server Enforcement

Bei jedem Run:

1. Profile gehört User oder ist Built-in.
2. Feature Gates sind aktiv.
3. Skill ist im Registry-Inventar vorhanden.
4. Skill ist im Base Profile erlaubt.
5. Skill ist im Nutzerprofil aktiviert.
6. erforderliches Action Level ist vorhanden.
7. Account gehört User und ist im Profil freigegeben.
8. Venue Capability ist vorhanden.

Alle acht Prüfungen serverseitig.

## UI

Skill Drawer mit zwei Tabs:

### Skills

Gruppiert:

- Marktdaten
- Intelligence
- Predictions
- Konto & Portfolio
- Aktionen

Jeder Skill zeigt:

- Titel,
- kurze Beschreibung,
- Datenquelle,
- Read-only/Draft Badge,
- eventuell erforderliches Konto,
- Verfügbarkeit für aktuelle Venue.

### Berechtigungen

- erlaubte Exchange Accounts,
- Public-only oder Account Read,
- Standardvenue,
- Marktart,
- später Draft Actions.

## Sichere Defaults

- neues Profil startet Public-only,
- Account Reads explizit opt-in,
- keine Konten pauschal auswählen,
- Trade Drafts aus,
- fehlende Capability deaktiviert Skill sichtbar,
- Profiländerungen gelten erst nach Speichern.

## Tests

- Built-in Profile sind stabil versioniert,
- User kann fremdes Profil nicht lesen,
- aktivierter Portfolio Skill ohne Account Permission wird abgelehnt,
- Account Permission ohne Skill führt nicht zu Tool-Zugriff,
- Profile kann keine Forbidden Tools hinzufügen,
- entfernte Account-Berechtigung wirkt beim nächsten Run,
- Profile Snapshot wird im Audit gespeichert.

## Akzeptanzkriterien

- Nutzer versteht Skills und Rechte getrennt,
- Market Analyst funktioniert ohne private Daten,
- Position Copilot nur mit explizit erlaubtem Konto,
- alle Policies serverseitig erzwungen.
