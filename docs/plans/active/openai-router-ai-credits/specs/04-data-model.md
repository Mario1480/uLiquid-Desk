# 04 – Ziel-Datenmodell

Da keine produktiven Altbestände bestehen, Felder direkt ersetzen statt parallel weiterzuführen.

## UserSubscription

Ersetze:

- `aiTokenBalance` → `aiCreditBalance`
- `aiTokenUsedLifetime` → `aiCreditsUsedLifetime`
- `monthlyAiTokensIncluded` → `monthlyAiCreditsIncluded`

Ergänze optional:

- `aiCreditsReserved`
- `aiDailyLimitCredits`
- `aiMonthlyLimitCredits`
- `aiMaxRunCredits`

## BillingPackage

Ersetze `monthlyAiTokens` durch `monthlyAiCredits`. `aiCredits` bleibt als Add-on-Menge bestehen.

## AiCreditLedger

Benenne `AiTokenLedger` direkt um und ersetze:

- `deltaTokens` → `deltaCredits`
- `balanceAfter` → `balanceAfterCredits`

Ergänze:

- `agentRunId`
- `reservationId`
- `providerCostMicrousd`
- `retailCostMicrousd`
- `pricingRevisionId`

## AiModelPricing

Versionierte Preise:

```prisma
model AiModelPricing {
  id                         String   @id @default(cuid())
  provider                   String
  model                      String
  inputMicrousdPerMillion    BigInt
  cachedInputMicrousdPerMillion BigInt
  cacheWriteMultiplierBps    Int      @default(12500)
  outputMicrousdPerMillion   BigInt
  longContextThresholdTokens Int?
  longInputMultiplierBps     Int?
  longOutputMultiplierBps    Int?
  markupBps                  Int
  revision                   Int
  effectiveFrom              DateTime
  effectiveUntil             DateTime?
  isActive                   Boolean  @default(true)
  createdAt                  DateTime @default(now())

  @@unique([provider, model, revision])
  @@index([provider, model, effectiveFrom])
}
```

## AiAgentRun

Ein Nutzerauftrag kann mehrere Modellaufrufe umfassen:

- userId
- conversationId
- scope/profile
- status
- routingDecision
- reservedCredits
- chargedCredits
- providerCostMicrousd
- retailCostMicrousd
- modelCallCount
- toolRoundCount
- startedAt/completedAt
- errorCode
- idempotencyKey

## AiUsageRecord

Pro OpenAI-Aufruf:

- agentRunId
- provider/model/modelClass
- inputTokens
- cachedInputTokens
- cacheWriteTokens, sofern verfügbar/ableitbar
- outputTokens
- reasoningTokens zur Analyse, aber nicht doppelt abrechnen, sofern bereits in Output enthalten
- providerCostMicrousd
- retailCostMicrousd
- chargedCredits
- pricingSnapshot JSON oder Pricing FK + kopierte Tariffelder
- success/errorCode/latency
- OpenAI request ID, sofern verfügbar

## AiCreditReservation

Separate Reservierung mit Status:

- ACTIVE
- SETTLED
- RELEASED
- EXPIRED
- FAILED

Eine Reservierung muss idempotent und eindeutig einem Agent Run zugeordnet sein.
