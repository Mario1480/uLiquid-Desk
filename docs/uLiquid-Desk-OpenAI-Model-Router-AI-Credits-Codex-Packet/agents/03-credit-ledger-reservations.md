# Agent 03 – Credit Ledger und Reservierungen

- Ersetze `checkAiTokenAccess`/`debitAiTokens` durch Credit APIs.
- Implementiere Reserve, Settle, Release, Refund.
- Atomar, idempotent, concurrency-safe.
- Verhindere negatives verfügbares Guthaben.
- Baue Timeout-Reconciliation für hängende Reservierungen.
- Integriere Top-ups und Monatsgrants in bestehendes Billing.
- Tests mit parallelen Transaktionen und Retries.
