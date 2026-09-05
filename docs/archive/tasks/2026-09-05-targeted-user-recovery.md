# Targeted user recovery — 2026-09-05

## Authorization and scope

Mario authorized inspection and, if feasible, recovery of one accidentally deleted Desk account. Recovery was limited to that account and its dependencies on the Desk production server. No deployment, service restart, trading action, or onchain call was performed.

## Evidence

- The deletion audit event identified the original account; the September 1 release backup contained the same ID.
- A fresh full database backup was saved before recovery in `/var/backups/uliquid-desk/recovery-20260905-hello/before.dump`. Sensitive recovery artifacts remain on the server with restricted permissions and are not included here.
- The source backup was restored to a separate database for dependency inspection.
- All required parent records existed or were included in the selected recovery set. No bots were present. The exchange connection was a paper account. The funding-vault record retained its original `operator_missing` state; onchain state was not inspected or changed.
- A production transaction dry run passed immediate foreign-key constraints and row-count assertions, then rolled back. No non-internal database triggers were present.
- The committed transaction inserted 109 records across 18 tables and restored 13 null user links on retained trace records. Existing records were otherwise preserved.
- Five stale running AI requests were marked failed with `interrupted_by_account_recovery`. Three historical Telegram link sessions were excluded. Authentication sessions and one-time codes were not reactivated.
- All restored fields were compared against the recovery selection after commit, except the explicitly adjusted stale-request fields. Original password data matched the backup and the account remained email-verified. The backup contained no backend-access grant for this account.
- API health and the Desk login route both returned HTTP 200. Interactive login was not performed.

## Limits

Recovered data reflects the September 1 backup. Changes between that backup and deletion are not established as recovered. A successful database restoration does not establish current funding-vault or external account reconciliation. Existing trading and onchain authorization boundaries remain in force.
