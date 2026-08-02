# AI Safety and Tool Boundaries – Nachweis

Stand: 2026-08-02

## Ergebnis

Die drei Limited-Beta-AI-Scopes besitzen getrennte, serverseitig durchgesetzte Registries und gemeinsame Prompt-, Output- und Logging-Grenzen. Der Prediction Copier bleibt eine getrennte deterministische Runner-Runtime ohne AI-Tool-Loop.

Die vollständige Matrix steht in `docs/ai-safety-tool-matrix.md`.

## Wesentliche Änderungen

- Zentrale Scope-Policy und Tool-Inventar unter `apps/api/src/ai/safety/toolPolicy.ts`.
- Market Analysis filtert Tool-Definitionen nach Scope und führt Tools nur über den scoped Executor aus.
- Tool- und Token-Iterationen werden unabhängig von Caller- oder Environment-Werten auf Policy-Limits begrenzt.
- Prediction Builder verwendet die zentrale Workflow-Allowlist, serverseitige Workflow-Prüfung und eine gemeinsame Prompt-Injection-Grenze.
- Position Monitoring verwendet dieselbe Policy, weiterhin mit leerer callable Tool-Registry.
- AI Trace Logging redigiert Secrets rekursiv vor Persistierung.
- Prediction Copier prüft User- und Account-Zuordnung zusätzlich im deterministischen Evaluator.
- AI-förmige Risk-Override-Felder verändern keine Copier-Risikogrenze.

## Automatisierte Prüfungen

- `npm -w apps/api run typecheck`
- `npm -w apps/runner run typecheck`
- `npm -w apps/api run test:ai`
- `node --import tsx --test apps/api/src/ai/safety/toolPolicy.test.ts apps/api/src/ai/tools/index.test.ts apps/api/src/position-copilot/*.test.ts`
- `node --import tsx --test apps/api/src/ai/promptGenerator.test.ts apps/api/src/strategies/routes-write.test.ts`
- `node --import tsx --test apps/runner/src/prediction-copier.test.ts`
- `git diff --check`

## Manuelle Smoke-Prüfung

1. Market Analysis mit einer Prompt-Injection im Nutzertext starten und prüfen, dass nur die vier Read-Tools angeboten werden.
2. Einen erfundenen Tool Call wie `place_order` simulieren und die serverseitige Ablehnung prüfen.
3. Im Prediction Builder eine Copier-Aktivierung verlangen; es darf nur ein validierter Draft beziehungsweise Fallback erscheinen.
4. Builder Preview öffnen und sicherstellen, dass keine Prediction, Order oder Copier-Konfiguration erzeugt wird.
5. Template speichern und prüfen, dass die Analyse-only-Bestätigung erforderlich ist.
6. Position Copilot mit einem fremden Exchange-Konto anfragen und den Abbruch vor dem AI-Aufruf prüfen.
7. Einen Prediction Record mit fremdem User sowie einen behaupteten `riskGateOverride` in einem Runner-Test prüfen; beide dürfen keine Orderfreigabe erzeugen.
8. AI Trace Testdaten mit API Key, Passphrase und Bearer Token verarbeiten und prüfen, dass nur `[REDACTED]` persistierbar bleibt.

## Restpunkte

- Diese Aufgabe verändert keine Production-Konfiguration und aktiviert keine zusätzlichen AI- oder Trading-Funktionen.
- Die globale Limited-Beta-Freigabe bleibt offen, solange `01`, `07`, `08` und `09` nicht abgeschlossen sind.
