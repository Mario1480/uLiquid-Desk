# Agent 01 – Schema und direkte Migration

- Ersetze alle Token-Balance-Felder durch Credit-Felder.
- Benenne `AiTokenLedger` in `AiCreditLedger` um.
- Erstelle `AiModelPricing`, `AiAgentRun`, `AiUsageRecord`, `AiCreditReservation`.
- Aktualisiere Enums/Reasons.
- Erstelle eine direkte Prisma-Migration ohne Legacy-Dual-Write.
- Setze bestehende ungenutzte AI-Balances kontrolliert auf 0 bzw. migriere nur strukturell.
- Aktualisiere Seeds und Fixtures.
- Tests: Schema, Constraints, Indizes, Idempotency.
