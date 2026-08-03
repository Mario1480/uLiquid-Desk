# Agent 07 – Agent Activity, Audit und Observability

## Auftrag

Mache jeden Agent Run technisch und für den Nutzer nachvollziehbar, ohne Secrets oder unnötige Rohdaten zu speichern.

## Ebenen

### User-facing Agent Activity

Zeigt:

- Skill Name,
- Source Venue/Provider,
- Status,
- Dauer,
- Freshness/Degraded,
- eventuell Anzahl geladener Datensätze.

Zeigt nicht:

- API Keys,
- Signaturen,
- interne Credentials,
- vollständige Prompt-Texte,
- komplette rohe Exchange-Payloads,
- fremde oder unnötige Account IDs.

### Persistenter Audit Trail

- Run Summary in `AiTraceLog` oder einem ergänzenden Run-Modell,
- einzelne Tool Calls als Child Records,
- Profile Snapshot,
- Skill Allowlist Snapshot,
- serverseitig gebundener Context,
- Success/Error/Blocked,
- Provider/Model/Token Usage,
- Cache/Fallback/Rate Limit,
- Latenz.

## Empfohlene Events

- `agent_run_started`
- `agent_tool_allowed`
- `agent_tool_blocked`
- `agent_tool_started`
- `agent_tool_completed`
- `agent_tool_failed`
- `agent_run_completed`
- `agent_run_failed`
- `agent_run_budget_exceeded`
- später `agent_action_draft_created`

## Tool Result Summary

Persistiere nur eine bereinigte Zusammenfassung, etwa:

```json
{
  "sourceVenue": "hyperliquid",
  "symbol": "ETH",
  "recordCount": 200,
  "observedAt": "...",
  "degraded": false,
  "fallbackUsed": false
}
```

Keine vollständigen 1000 Candles in der Datenbank.

## Retention

Definiere explizit:

- Conversations/Messages nach Nutzerlöschung entfernen,
- Tool Activity begrenzte Retention oder kompakte Speicherung,
- AiTraceLog bestehender Policy folgen,
- keine Secrets in Backups.

Konkrete Retention an Produkt-/Legal-Kontext anpassen und dokumentieren.

## Metriken

- Runs pro Profil,
- Tool Calls pro Skill/Venue,
- Error Rate,
- Degraded Rate,
- Fallback Rate,
- p50/p95 Latenz,
- Token Usage,
- Cache Hit Rate,
- Budget Exceeded,
- Blocked Tool Attempts,
- Account Access Denied.

## Admin/Ops

Kein vollständiger Prompt-Inhalt als Standardansicht. Admin sieht:

- User/Run IDs,
- Scope/Profile,
- Provider/Model,
- Skills,
- Status,
- Fehlercode,
- Redaction-Status,
- Latenz/Kosten.

## Tests

- Secrets werden rekursiv redigiert,
- Tool Activity bleibt nach Reload erhalten,
- fremde Activity nicht lesbar,
- große Tool Resultate werden nicht vollständig persistiert,
- blocked Tools erscheinen im Audit,
- Provider- und Venue-Fallback ist sichtbar,
- Metrics Labels enthalten keine hochkardinalen Geheimdaten.

## Akzeptanzkriterien

- Nutzer kann nachvollziehen, worauf eine Antwort basiert,
- Support kann Fehler untersuchen,
- Logs und DB enthalten keine Credentials,
- Kosten und Degradation sind messbar.
