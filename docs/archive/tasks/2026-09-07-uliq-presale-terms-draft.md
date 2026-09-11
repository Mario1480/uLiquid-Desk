# ULIQ presale terms draft implementation

Date: 2026-09-07. Scope: original general-purpose EN/DE presale terms, explicit seller/address/contact placeholders, and local page rendering. Mario requested no MiCA-specific sections. No third-party template was copied. Existing mandatory-rights reservations are general and do not assert jurisdiction-specific compliance.

The page now contains eleven sections covering seller identity, network/token identity, both sale rounds, pending custody and Safe treasury release, withdrawal, finalization, vesting, listing/manual exceptions, network fees, risks and versioning. The draft notice remains visible. The content reflects the existing 14-day contractual window and actual 5%/25% initial release schedules; it does not create new contract functionality.

## Validation

- `npm -w apps/web run i18n:check`: passed.
- `npm -w apps/web run typecheck`: passed, including regenerated route types.
- `git diff --check`: passed.
- Direct TypeScript invocation initially found duplicate generated `.next/types/* 2.ts` and `* 3.ts` declarations. The repository's normal typecheck cleanup/typegen workflow resolved them.
- Browser checks of the local route at port 3307 were attempted with Turbopack and webpack but hit `ERR_TOO_MANY_REDIRECTS`; HTTP headers showed a locale rewrite and redirect back to the same localized path. Rendered desktop/mobile acceptance remains unverified. No routing/authentication changes were made to work around this.
- The missing `/hooks/validate-schema.py` post-edit hook reported errors; diff inspection and the successful normal TypeScript/i18n checks confirmed the writes.

No contract, API, terms-acceptance version/hash, purchase gate, production environment, deployment, commit or push was changed by this task. Prior ULIQ approval-document worktree changes were preserved. Seller placeholders and final purchase-terms version/hash still require completion before using this as final purchase terms.

Review copy: [English draft](../../plans/active/uliq/ULIQ_PRESALE_TERMS_DRAFT.md). The rendered DE/EN message files remain the source of page copy.
