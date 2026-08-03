# 01 – Repository-Iststand

## Vorhandene Billing-Basis

`UserSubscription` enthält derzeit:

- `aiTokenBalance`
- `aiTokenUsedLifetime`
- `monthlyAiTokensIncluded`

`BillingPackage` enthält bereits:

- `monthlyAiTokens`
- `aiCredits`

`AiTokenLedger` enthält:

- `deltaTokens`
- `balanceAfter`
- Reasons wie Grant, Top-up, Usage Debit und Admin Adjustment
- optionalen Idempotency Key

`apps/api/src/billing/service.ts` bietet bereits:

- AI-Zugangsprüfung
- atomaren Debit per `updateMany` mit Mindestguthaben
- Ledger-Einträge
- monatliche Grants
- Top-up-Pakete
- Admin-Anpassungen
- Arbitrum-USDC-Billing und Order-Abwicklung

## Vorhandener AI-Provider

`apps/api/src/ai/provider.ts`:

- nutzt derzeit primär Chat Completions
- besitzt OpenAI/Ollama/vLLM Provideroptionen
- erlaubt aktuell `gpt-5-nano`, `gpt-5-mini`, `gpt-4.1-nano`, `gpt-4o-mini`
- prüft vor dem Call nur, ob AI-Guthaben verfügbar ist
- belastet nach dem Call `totalTokens`
- behandelt Input und Output gleich

## Vorhandenes Tracing

`AiTraceLog` erfasst bereits Scope, Provider, Modell, Prompt-Kontext, Ergebnis, Fehler, Cache-Hit und Latenz. Es fehlen Kosten-, Run- und Usage-Beziehungen.

## Schlussfolgerung

Die Zahlungs-, Ledger- und Transaktionsgrundlage ist wiederverwendbar. Die Semantik muss jedoch vollständig von Roh-Tokens auf Credits/Kosten umgestellt werden. Da keine produktiven Altbestände existieren, wird keine Legacy-Kompatibilität implementiert.
