# Agent 03 – Agent Chat Runtime und Conversations

## Auftrag

Implementiere eine allgemeine Chat-Runtime mit Tool Loop, Conversation Persistence und Streaming-/Progress-Unterstützung, ohne das bestehende `AgentSignal`-Schema zu erzwingen.

## Grundsatz

`apps/api/src/ai/agent.ts` ist ein spezialisierter Signal-Agent. Kopiere den Tool Loop nicht blind. Extrahiere kleine gemeinsame Utilities, sofern dies sicher ist:

- Tool-Call-Normalisierung,
- Tool-Result-Serialisierung,
- Iterations-/Call-Budget,
- Provider Usage Aggregation,
- Tool Logging,
- Abort/Timeout.

Die finale Agent-Chat-Antwort ist natürlicher Text plus optionale strukturierte UI-Blöcke.

## Antwortvertrag

```ts
type AgentChatResponse = {
  messageId: string;
  content: string;
  blocks: AgentUiBlock[];
  citations: AgentSourceRef[];
  run: {
    id: string;
    provider: string | null;
    model: string | null;
    toolIterations: number;
    toolCalls: number;
    latencyMs: number;
    degraded: boolean;
  };
};
```

Mögliche UI-Blöcke:

- `summary`
- `key_metrics`
- `risk_findings`
- `scenario_table`
- `prediction_comparison`
- `source_list`
- später `action_draft_card`

Alle Blocks werden serverseitig per Zod validiert. Bei ungültigen Blocks bleibt der Text verfügbar und Blocks werden verworfen.

## Conversation Context

```ts
type AgentConversationContext = {
  profileId: string;
  selectedVenue: string | "auto";
  selectedExchangeAccountId: string | null;
  marketType: "spot" | "perp" | null;
  symbol: string | null;
  locale: "de" | "en";
};
```

Context wird serverseitig gespeichert und bei jedem Run neu autorisiert.

## API-Routen

MVP:

- `GET /api/agent-chat/profiles`
- `GET /api/agent-chat/conversations`
- `POST /api/agent-chat/conversations`
- `GET /api/agent-chat/conversations/:id`
- `PATCH /api/agent-chat/conversations/:id`
- `DELETE /api/agent-chat/conversations/:id` oder Archive
- `POST /api/agent-chat/conversations/:id/messages`
- `GET /api/agent-chat/runs/:id/activity`

Optional Streaming:

- SSE oder vorhandenes kompatibles Streaming-Muster,
- mindestens Events: `run_started`, `tool_started`, `tool_completed`, `answer_delta`, `run_completed`, `run_failed`.

Falls Streaming im ersten Schritt zu groß ist, pollbare Activity plus atomare Antwort implementieren. Entscheidung dokumentieren.

## Runtime Budgets

Vorschlag für MVP, serverseitig clampen:

- maximal 4 Tool-Iterationen,
- maximal 12 Tool Calls pro Run,
- maximal 2 Calls je teurem Skill,
- maximal 20 Sekunden Gesamtzeit,
- maximal 2.200 Output-Tokens,
- Conversation Context nur letzte relevante Messages plus Summary,
- harte Payload-Größenlimits.

Konkrete Werte an vorhandenes Billing und Provider-Verhalten anpassen.

## Conversation Memory

Nicht den kompletten Verlauf unbeschränkt senden.

- letzte 8–12 Messages,
- serverseitige Conversation Summary,
- aktuelle Context-Auswahl,
- aktuelle Profile-/Skill-Snapshot,
- relevante Tool-Ergebnisse des laufenden Runs.

Keine implizite Langzeit-Memory über andere Conversations.

## Prompt-Aufbau

1. serverseitige System Boundary,
2. Agent Profile Instructions,
3. aktive Skills und Rechte,
4. Conversation Context,
5. komprimierter Verlauf,
6. aktuelle User Message als untrusted data.

Tool-Resultate ebenfalls mit `wrapUntrustedAiPayload` bzw. äquivalenter Schutzschicht versehen.

## Run-Zustände

- `queued`
- `running`
- `completed`
- `failed`
- `cancelled`
- `budget_exceeded`

Keine Background-Versprechen an den Nutzer. Der API-Request oder Stream liefert den aktuellen Run bis Abschluss/Fehler.

## Tests

- neue Conversation und mehrere Messages,
- User kann fremde Conversation nicht lesen,
- Profile/Context werden pro Run neu geprüft,
- Tool Budget stoppt Endlosschleife,
- unbekannter Tool Call wird als Tool-Fehler behandelt und nicht ausgeführt,
- malformed UI Blocks werden verworfen,
- Provider-Ausfall liefert stabile Fehlermeldung oder klaren degraded Fallback,
- Conversation Summary enthält keine Secrets,
- Builder Conversation bleibt vollständig getrennt.

## Akzeptanzkriterien

- eigenständige Conversations,
- allgemeiner Tool-Loop ohne Signal-Schema,
- nachvollziehbare Run-Metadaten,
- robuste Limits und Ownership,
- keine Side Effects.
