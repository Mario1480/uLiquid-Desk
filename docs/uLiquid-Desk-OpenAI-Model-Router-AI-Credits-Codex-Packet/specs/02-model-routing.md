# 02 – OpenAI Model Routing

## Modellklassen

```ts
export type AiModelClass = "utility" | "standard" | "analysis" | "deep";
```

| Klasse | Modell | Zweck |
|---|---|---|
| utility | gpt-5-nano | Titel, Tags, Extraktion, einfache Klassifikation, kurze Notifications |
| standard | gpt-5.6-luna | normaler Agent Chat, Toolplanung, einfache Markt-/Positionsauswertung |
| analysis | gpt-5.6-terra | mehrere Skills, mehrere Timeframes, Portfolio- und Risikoanalyse |
| deep | gpt-5.6-sol | Strategieentwicklung, komplexe Trade-Drafts, widersprüchliche Daten, Deep Analysis |

OpenAI empfiehlt Luna für neue kosten- und geschwindigkeitssensitive Workloads. Nano bleibt nur für extrem einfache, gut evaluierte Utility-Aufgaben.

## Routing muss deterministisch sein

Kein Nano-Call als Intent Router. Nutze Request-Scope, Profil, Anzahl angefragter Märkte, Toolset, erwartete Kontextgröße und Aktionstyp.

### Beispielregeln

- Chat-Titel, Tagging, Symbol-/Timeframe-Extraktion → utility
- eine Position, höchstens 4 Read Skills, kein Portfoliovergleich → standard
- mehrere Symbole/Positionen oder Makro + News + Market Data → analysis
- Prediction-Strategie erstellen/überarbeiten → deep
- bestätigungspflichtiger Trade Draft mit umfassender Begründung → deep
- finale Formulierung nach abgeschlossener Terra-Analyse darf optional Luna nutzen, sofern dadurch kein zusätzlicher großer Kontexttransfer entsteht

## Kein Nutzer-Modellpicker

UI zeigt höchstens:

- Standardanalyse
- Erweiterte Analyse
- Tiefenanalyse, wenn der Workflow dies ausdrücklich anbietet

Die konkrete Modellentscheidung bleibt serverseitig. Für den ersten Release sollte selbst diese Moduswahl nur an klaren Funktionen hängen, nicht frei im Chat auswählbar sein.

## Router-Vertrag

```ts
export type AiRoutingInput = {
  scope: string;
  profile: "market_analyst" | "position_copilot" | "trading_assistant" | "prediction_builder";
  requestedSymbols: number;
  requestedAccounts: number;
  enabledSkills: string[];
  createsTradingDraft: boolean;
  expectedInputTokens?: number;
};

export type AiRoutingDecision = {
  modelClass: AiModelClass;
  model: string;
  reasoningEffort: "minimal" | "low" | "medium" | "high" | "max";
  maxOutputTokens: number;
  maxToolRounds: number;
  reasonCode: string;
};
```

## Konservative Defaults

- Standard-Agent: Luna, low/medium
- Position Copilot: Luna oder Terra anhand Komplexität
- Portfolio Analyst: Terra
- Prediction Builder: Terra für Validierung, Sol für Erzeugung/komplexe Überarbeitung
- Trade Draft: Sol, aber nur nach Vorab-Kostenschätzung und User-Bestätigung
