# Agent 06 – Position Copilot Integration statt Parallelbau

## Auftrag

Integriere die vorhandene Position-Copilot-Domänenlogik in den Agent Chat, ohne einen zweiten Analysepfad oder verschachtelte AI-Aufrufe zu erzeugen.

## Bestehende Wiederverwendung

Aus `apps/api/src/position-copilot/core.ts`:

- `buildPositionCopilotSnapshot`
- `hashPositionCopilotSnapshot`
- `buildDeterministicPositionAnalysis`
- bestehende Risk Level und Finding Types

Aus `routes.ts` und angrenzenden Trading-Datenquellen:

- Account Ownership Muster,
- Prediction-Copier-Herkunft,
- normalisierte Positionsfelder.

## Nicht verwenden als Agent Tool

`analyzePositionSnapshot` ruft selbst optional AI auf. Der allgemeine Agent Chat soll nicht einen zweiten AI-Agenten als Tool aufrufen.

Stattdessen:

```text
portfolio.get_positions
  → selected normalized position
  → risk.analyze_position_snapshot
  → deterministic PositionCopilotAnalysis
  → Haupt-Agent erklärt und kombiniert das Ergebnis
```

## Position Skill Input

Das Modell wählt nicht frei User oder Account.

```ts
type AnalyzePositionSkillInput = {
  positionRef: string; // opaque server-generated reference from current result set
};
```

Die Runtime löst den Ref innerhalb des aktuellen Users/Accounts auf.

Alternativ kann die UI eine konkrete Position als Context setzen, sodass das Tool `positionRef: "selected"` akzeptiert.

## Erweiterter Marktkontext

Der Agent darf zusätzlich laden:

- Ticker,
- OHLCV,
- Funding,
- Open Interest,
- News,
- Economic Events,
- letzte Prediction.

Diese Daten ändern die deterministische Mindest-Risikoeinstufung nicht. Die AI darf Risiko erläutern oder höher einstufen, aber nicht harte deterministische Warnungen entfernen.

## Bestehende Position-Copilot-UI

Der Trading Desk behält die kompakte read-only Analyse. Optionaler Link:

- „Im Agent Chat weiter analysieren“

Dieser Link öffnet `/agent-chat` mit sicherem, kurzlebigem Context-Token oder clientseitigem Prefill ohne Secrets:

- selected account,
- market type,
- normalized symbol,
- opaque position ref.

Keine kompletten Position-Snapshots in URL Query Strings.

## Prediction-Copier-Grenze

Der Agent darf anzeigen, dass eine Position vom Prediction Copier stammt. Er darf:

- Prediction erklären,
- Position gegen Prediction vergleichen,
- Abweichungen nennen.

Er darf nicht:

- Copier aktivieren/deaktivieren,
- Regeln ändern,
- Gegenorder erstellen,
- Exit ausführen.

## Tests

- deterministic Risk Result identisch zwischen Trading Desk und Agent Skill,
- kein nested AI Call,
- fremde Position Ref wird abgelehnt,
- stale Position Ref wird kontrolliert neu geladen oder abgelehnt,
- Prediction-Copier-Origin ist read-only,
- Agent kann Risk Level nicht unter deterministisches Minimum setzen,
- Deep Link enthält keine sensitiven Daten.

## Akzeptanzkriterien

- eine gemeinsame Risikologik,
- Trading Desk und Agent Chat widersprechen sich nicht strukturell,
- keine neuen Execution-Pfade,
- klarer Übergang vom kompakten Copilot zur tiefen Chat-Analyse.
