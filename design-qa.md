# ULIQ Hub Design QA

## Target

- Final combined mockup: Mockup 1 structure plus compact Recent Activity icon rows.
- Desktop target: 1440 x 1024.
- Mobile target: 390 x 844.
- Overview contains summary, lifecycle, exactly one Next Action, entitlement summary, and canonical Recent Activity.
- Forms and histories are separated into Presale, Vesting, and Locked routes.

## Implementation review

- Existing uLiquid shell, `uiSection`, button primitives, status badges, and `AppIcon` are reused.
- No custom inline SVGs or invented Round 2 configuration were added.
- Purchase controls are removed outside `ACTIVE` instead of only disabled.
- Lifecycle visibility and hidden-route redirects are derived by a deterministic helper with tests.
- Recent Activity uses wallet-isolated canonical events and shows `Partial history` while timestamps are incomplete.

## Automated evidence

- ULIQ API suite: passed, 83 tests.
- Hub lifecycle unit tests: passed, 3 tests.
- TSX syntax bundle for the ULIQ page and Activity service: passed.
- Canonical DE/EN ULIQ key parity: passed.
- `git diff --check`: passed.

## Open visual evidence

- Local Next dev server did not reach a listening state and produced no diagnostic output in repeated webpack/default starts.
- Full web/API typechecks likewise remained idle without output and were stopped after bounded waits.
- The repository-wide i18n command is blocked by the pre-existing untracked `apps/web/messages/en/uliq 2.json`, which has no German counterpart. That unrelated file was not changed.
- Because no fresh implementation render could be captured, the required same-viewport reference-versus-implementation image comparison is still open.

final result: blocked
