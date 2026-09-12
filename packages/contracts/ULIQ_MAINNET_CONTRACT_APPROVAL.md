# ULIQ Mainnet contract inputs and authority review

Date: 2026-09-07. Status updated 2026-09-12: Safe and authority setup are
owner-confirmed complete. Round 1 is deployed, bound, funded, and has a backend
schedule; Round 2 still needs exact sale timestamps and remains unfunded in the
current public snapshot. See the current
[ULIQ release status](../../docs/status/uliq-release-status.md). Historical
pre-deployment statements below are retained as dated evidence.


## Owner approval of items 1–3 — 2026-09-07

Mario explicitly approved the presented Safe addresses, parameters and admin rights, sale timing, and final contract wiring/deployment configuration ("alles richtig und gebe es hiermit frei"). This closes the requested owner review; do not request the same approval again. The approved Admin Safe is `0xf6EB22eC94be977A668967f44F89eB1e056FF70f`; the approved inventory source and USDC treasury Safe is `0x9C96F9AE59e30786fD325EFD969884FC1f751739`. Existing contract rights are approved as presented; disabling ownership renunciation was a recommendation and is not silently implemented by this record.

Approval and supplied execution inputs are separate: the reviewed timing table still contains no actual start/end dates for either round, and no final deployed-address manifest is present. Mario's message supplies no timestamps or new deployment addresses. Record those missing values before execution; never invent them or describe an unperformed onchain verification as completed. Requesting the four missing dates is a data clarification, not a repeat approval request. Independent audit and runtime/deployment evidence remain separate. No transaction was performed when recording this approval.

## Decisions already supplied by Mario

- Listing is committed to by the project. No additional automatic full-sale cancellation or never-listing refund mechanism is requested. Exceptional cases will be handled manually.
- Mario released the previously raised cancellation/safeguarding project gate and selected Safe-based treasury custody. This records the project owner's approval; it does not assert that an external legal opinion was received.
- Mainnet locker adaptation is authorized. Team/manual vesting is out of the current scope.
- Use native Arbitrum USDC in the local configuration templates and future constructor inputs.
- The presented contract rights, Safe addresses, parameters and wiring design are now approved by Mario. These decisions do not execute transactions.

## Actual funds flow

1. Buyer approves the round's separate custody contract, then buys through the round.
2. Pending USDC remains in that custody contract during the withdrawal period. It is not already a balance in the Treasury Safe.
3. The buyer can withdraw through the inclusive deadline and receive the full recorded USDC amount; buyer/wallet capacity is restored.
4. After the deadline, anyone can finalize for the immutable buyer. USDC goes to the active treasury address and the entire ULIQ allocation goes to that round's vesting pool.
5. Both rounds must have settled pending purchases and be listing-pending before the Admin schedules the shared listing timestamp. ULIQ claims then follow each pool's immutable schedule.

The project-selected Safe is the intended treasury recipient after finalization and the proposed contract administrator. Merely naming safe.global does not supply an onchain recipient address or change this custody flow. No admin can sweep pending USDC directly. Manual compensation after finalization requires available treasury funds and a separately recorded Safe payment; it cannot erase the buyer's onchain vesting entitlement or unlock unvested ULIQ. Manual exception handling is an accepted operational responsibility, not an implemented cancellation function.

## Address review

| Input | Prepared value | Status |
| --- | --- | --- |
| Chain | Arbitrum One, 42161 | Selected |
| Both round ULIQ tokens / both vesting tokens / Mainnet locker token | 0xF2Fa252134c84Fcf260c73665BAf3f8cCBe03EEd | Existing token; locker pins this value in code |
| Both round USDC tokens / both custody payment tokens | 0xaf88d065e77c8cC2239327C5EDb3A432268e5831 | Native USDC, 6 decimals; entered in both environment templates |
| Admin for listing, both rounds, both vesting pools and both custody contracts | 0xf6EB22eC94be977A668967f44F89eB1e056FF70f | Approved by Mario on 2026-09-07 |
| Immutable ULIQ inventory source for each round | 0x9C96F9AE59e30786fD325EFD969884FC1f751739 | Approved by Mario on 2026-09-07 |
| USDC treasury recipient for each custody contract | 0x9C96F9AE59e30786fD325EFD969884FC1f751739 | Exact recipient approved by Mario on 2026-09-07 |
| Round 1 predecessor | Zero address | Prepared input |
| Round 2 predecessor | Actual Round 1 deployment | Must be reconciled after deployment |
| Listing / round / vesting / custody / locker addresses | No final deployment manifest yet | Determined and independently reconciled before funding |

Native USDC identity source: [Circle contract directory](https://developers.circle.com/stablecoins/usdc-contract-addresses). Treasury and Admin Safe signer/threshold evidence in the role matrix is a historical snapshot, not a fresh signer check. The recorded configuration is two signers with a 2-of-2 threshold; either missing signer can prevent required owner actions. Signer recovery and the Admin Safe execution rehearsal are still deployment preparation items.

## Economic and timing inputs

These are the prepared ADR-009/API inputs. The generic presale and vesting constructors accept parameters; they do not hard-code every row below.

| Parameter | Round 1 | Round 2 |
| --- | --- | --- |
| ULIQ inventory | 50,000,000 | 100,000,000 |
| Price per ULIQ | 0.002 USDC | 0.0035 USDC |
| Hard cap | 100,000 USDC | 350,000 USDC |
| Minimum purchase | 500 USDC | 100 USDC |
| Cumulative maximum per wallet and round | 10,000 USDC | 5,000 USDC |
| Withdrawal period | 1,209,600 seconds (14 days) | 1,209,600 seconds (14 days) |
| Initial claim at shared listing | 5% | 25% |
| Cliff after listing | 90 days | None |
| Linear release of remainder | 548 days after cliff | 274 days after listing |
| Sale start / end | Backend draft: `2026-09-19T12:00:00Z` / `2026-12-31T12:00:00Z`; onchain state remains `DRAFT` | Exact UTC timestamps pending |

No soft cap. Withdrawal releases used wallet/cap capacity. Amounts round down; the final fully vested claim releases all remaining principal. Round 2 activation requires Round 1 to have ended. The last purchase's withdrawal deadline can extend beyond sale end; listing cannot bypass it. Dates are editable only in DRAFT and freeze at READY. An expired READY round can now end without activation.

## Existing contract powers

| Contract / actor | Allowed actions | Limits |
| --- | --- | --- |
| Round owner (proposed Admin Safe) | Configure DRAFT dates; mark READY; activate; pause/unpause purchases; mark listing-pending; complete sale; release unsold ULIQ | No price/cap/token/source changes; no buyer fund sweep; unsold return only to the immutable source after end and zero pending purchases |
| Round inventory source | Approve and call fundInventory once in DRAFT | Pulls exactly that round's full allocation |
| Anyone | End an expired READY/ACTIVE/PAUSED round; end economically exhausted ACTIVE/PAUSED round under existing guards; finalize matured purchases; acknowledge listing launch | No beneficiary or payment redirection; no early ending of a READY round |
| Buyer | Buy; withdraw own pending purchase through deadline | No pre-listing ULIQ claim; no withdrawal after finalization |
| Listing owner | Bind exactly two distinct deployed rounds once; schedule one future listing timestamp | Both rounds must be ready for listing; cannot reschedule; no DEX/pool verification in code |
| Vesting owner | Bind a deployed presale once before listing is scheduled | Cannot allocate manually, change schedule, confiscate or withdraw buyer allocations |
| Bound presale | Fund and allocate beneficiary vesting | No external CSV/whitelist allocation path |
| Vesting beneficiary | Claim own vested balance | Cannot claim another person's balance or before listing |
| Custody owner | Bind matching presale once; propose/cancel treasury change; recover foreign tokens to current treasury | Cannot sweep configured USDC, including unsolicited USDC surplus; no generic refund or release bypass |
| Proposed new treasury | Accept its own nomination | Acceptance is required before future releases change destination |
| Bound presale only | Collect, refund or release each custody payment once | Stored buyer/amount must match; refund and release are mutually exclusive |
| Mainnet locker position owner | Lock ULIQ, extend own expiry, unlock own position at expiry | No early exit, shortening, transfer of position, seizure or second withdrawal |

Round, vesting and listing inherit two-step ownership transfer AND owner-only renounceOwnership. Custody also has two-step ownership transfer but explicitly disables renunciation. The existing renunciation permissions have not been changed: abandoning owner rights while required setup/listing actions remain can strand progress. This is included for Mario's requested review.

All these contracts are non-upgradeable. Round token/custody/vesting/listing/predecessor/source/economics, vesting schedule and locker token are immutable. Custody's treasury is deliberately rotatable through proposal and recipient acceptance. Graph checks are partial: an operational preflight must verify every reciprocal reference, chain, owner and constructor value before funding.

## Mainnet locker adaptation

`src/uliq/mainnet/ULIQMainnetLocker.sol` reuses the previously reviewed network-neutral `legacy-testnet/ULIQLocker.sol` logic through inheritance. It adds a constructor with no inputs, rejects every chain except 42161, pins the existing ULIQ address, and requires code and 18 decimals there. The inherited source is a production dependency of this adapter and must be included in its final audit.

Initial periods remain exactly 32, 185 and 367 days, including the existing operational day. The owner may extend strictly later, including by a duration outside these three initial terms. There is no admin/owner role, pause, upgrade, token replacement, early release or rescue function. Locking is independent of the shared presale listing timestamp.

`script/uliq/mainnet/DeployULIQMainnetLocker.s.sol` prepares the isolated deployment. No script was broadcast. The existing backend legacy locking namespace still enforces Sepolia; do not place the new Mainnet locker in it. Mainnet runtime integration and activation are separate remaining work.

## Item-3 approval recorded

Mario approved the presented Safe role addresses, exact USDC treasury recipient, economic parameters and existing authority table, including renunciation and treasury rotation. Concrete UTC start/end values for both rounds have not yet been supplied. The current item-1 decision and deferral of manual vesting are already recorded and do not need to be reapproved.

Full Mainnet graph deployment/configuration, source verification, Safe execution, API/indexer/UI acceptance and independent external audit remain separate evidence. The original sealed internal audit is preserved unchanged; this Mainnet adapter and native-USDC follow-up are subsequent changes.

## Local validation evidence

The full ULIQ suite passed 98 tests (three optional fork tests skipped), and both explicit fork scenarios passed using actual deployed ULIQ/native USDC and the Mainnet locker at finalized block 502661705. The contract build and scoped formatting passed. See [dated Mainnet preparation evidence](../../docs/archive/tasks/2026-09-07-uliq-mainnet-preparation.md) for fixture assumptions, exact commands and remaining runtime/deployment scope.
