# Codex Master Prompt

Du arbeitest im Repository `uLiquid-Desk` und implementierst die OpenAI-Modellsteuerung sowie die kostenbasierte AI-Credit-Abrechnung für den neuen Agent Chat und bestehende AI-Funktionen.

## Ziel

Ersetze das ungenutzte rohe Token-Guthaben vollständig durch ein monetär bewertetes Credit-System. Implementiere einen serverseitigen, deterministischen OpenAI-Modellrouter für GPT-5 nano, GPT-5.6 Luna, GPT-5.6 Terra und GPT-5.6 Sol. Nutzer dürfen Provider und Modell zunächst nicht auswählen.

## Bestehende Integrationspunkte

- `apps/api/src/ai/provider.ts`
- `apps/api/src/billing/service.ts`
- `prisma/schema.prisma`
- `apps/api/src/ai/promptGenerator.ts`
- `apps/api/src/ai/predictionExplainer.ts`
- `apps/api/src/position-copilot/`
- bestehende Settings-, Billing- und Admin-Routen

## Harte Vorgaben

1. Nur OpenAI im neuen Agent- und Billing-Pfad. Ollama/vLLM dürfen aus bestehendem Code entfernt oder außerhalb dieses Pfads belassen werden, aber nicht als Nutzeroption für den Agent Chat erscheinen.
2. Keine Legacy-Sonderbehandlung. Das alte System wurde nicht genutzt. Felder, APIs und UI dürfen direkt umbenannt bzw. ersetzt werden.
3. Kein Floating Point für Geld oder Credits. Nutze `BigInt` und ganzzahlige Microusd-/Credit-Einheiten.
4. Preise dürfen nicht nur hartcodiert sein. Es braucht eine versionierte Preis-Registry mit Gültigkeitszeitraum und Snapshot pro Usage Record.
5. Vor jedem kostenpflichtigen Agent Run muss eine Reservierung erfolgen. Nach Abschluss folgt Settlement und Freigabe des Restbetrags.
6. Jeder OpenAI-Aufruf wird einem `AiAgentRun` zugeordnet und einzeln als `AiUsageRecord` erfasst.
7. Idempotenz ist für Reserve, Settle, Release, Refund und Top-up zwingend.
8. Ein fehlgeschlagener OpenAI-Aufruf wird nur nach tatsächlich gemeldeter Nutzung belastet. Nicht genutzte Reservierung wird freigegeben.
9. Tool-Runden, Input, Output, Reasoning, Kontextgröße, Run-Kosten und Laufzeit erhalten harte Serverlimits.
10. Sol darf nicht standardmäßig verwendet werden. Sol ist nur für definierte Deep-Workflows zulässig.
11. Modelle erzeugen Trading Intents oder Drafts; sie umgehen niemals Risk Engine, Auth, Bestätigung oder Exchange-Adapter.
12. Keine Secrets, vollständigen Prompts oder Kontodaten in Billing-Metadaten speichern.
13. Bestehende Tests müssen weiterlaufen; neue Unit-, Integration- und Concurrency-Tests sind Pflicht.

## Zielrouting

- `utility` → `gpt-5-nano`
- `standard` → `gpt-5.6-luna`
- `analysis` → `gpt-5.6-terra`
- `deep` → `gpt-5.6-sol`

Der Router ist zunächst regelbasiert. Kein zusätzlicher LLM-Aufruf nur zur Modellauswahl.

## Zielabrechnung

- Plattformabo: Feature-/Kapazitätszugang.
- AI Credits: Prepaid-Verbrauchsguthaben.
- Empfehlung: 1 Credit = $0.001 Retail-Wert; 1.000 Credits = $1.00.
- Nutzerbelastung = aufgerundete Provider-Istkosten × konfigurierbarer Markup-Faktor plus optionale klar definierte Tool-Kosten.
- Markup wird in Basis Points gespeichert, nicht als Float.
- Preisberechnung nutzt den beim Request gültigen Pricing Snapshot.

## Arbeitsweise

- Lies zuerst alle Dateien in `specs/`.
- Setze die Agentenpakete unter `agents/` in nummerierter Reihenfolge um.
- Erstelle kleine, reviewbare Commits/Änderungsblöcke.
- Dokumentiere Abweichungen und begründe sie.
- Aktiviere neue Funktionen hinter Feature Flags.
- Stoppe nicht wegen kleiner Unklarheiten; entscheide konservativ und dokumentiere die Annahme.
