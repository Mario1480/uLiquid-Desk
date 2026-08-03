# Agent 04 – OpenAI Responses Provider

- Erstelle einen neuen OpenAI-Responses-API-Pfad für Agent Runs.
- Beschränke neue Agentenfunktionen auf OpenAI.
- Unterstütze Streaming, Function Calling, Structured Outputs und Usage Parsing.
- Erweitere Modell-Allowlist um nano, Luna, Terra, Sol.
- Speichere OpenAI Request ID, Modell und Usage.
- Keine automatische kostenverändernde Modell-Fallback-Kette ohne erneute Routing-/Reserveprüfung.
- Bestehende Prediction-Pfade können schrittweise migriert werden, müssen aber am Ende dieselbe Credit Engine verwenden.
