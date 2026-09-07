# Beta access applications and invitations

Status: code and additive migration deployed on 2026-09-07; Turnstile configuration, privacy approval and intake activation remain open. See [production release evidence](../archive/tasks/2026-09-07-presale-beta-production-release.md). Public registration and beta intake remain closed. Live email delivery and full production invitation redemption have not been tested.

## Flow and material ownership

When public registration is explicitly closed, `/register` can show an application form. Loading or failed registration settings never enable either flow. The independent beta setting defaults off. `GlassAuthFrame`, Desk inputs/textarea/buttons/checkbox/switch/badge/table and the existing Ein confirmation dialog own the UI. Ocean materials and single-color actions are unchanged. Both languages are supported.

The application contains email and a short motivation (1–1,000 characters), locale and abuse checks, not a password or product agreement. It creates no user, workspace, plan or paper account. Email confirmation uses a 24-hour token and an explicit POST triggered by a button. Confirmed requests become PENDING. Platform superadmins can approve, defer, reject, revoke invitations, resend invitations or delete application data. Ordinary workspace admins cannot access this API.

Approval produces a seven-day invitation bound to the confirmed email. Resending replaces the previous token. Revocation is immediate. Invitations remain redeemable if intake closes. Redemption requires a password and active acceptance of the current legal version; the account, legal acknowledgement and consumed invitation are committed in one transaction. Existing accounts are never overwritten. The normal login flow is used after setup; redemption does not create a session.

Workspace creation reuses the existing role/membership helper with an explicit transaction client and advisory lock. Free-plan and default-paper setup reuse existing idempotent helpers. The account remains email-unverified until these steps succeed. A database lease and the API maintenance task retry incomplete provisioning every minute, with a five-minute lease after failures. Investigate `beta_access_provisioning_retry` events and COMPLETED entries still showing setup pending; no provider errors or personal details are logged by this feature. Resolve stuck setup before the 30-day application retention deadline.

## Interfaces and storage

- `GET /auth/beta-access`: intake availability and public Turnstile site key.
- `POST /auth/beta-access` and `/resend`: email, motivation (resend uses a non-persisted placeholder), locale, honeypot and Turnstile token. Eligible and ineligible addresses receive the same accepted response; no public application-status lookup.
- `POST /auth/beta-access/confirm`: verification token.
- `POST /auth/beta-access/invitation`: read-only invitation lookup by token; returns fixed email and current legal version.
- `POST /auth/beta-access/complete`: invitation token, password, explicit legal acknowledgement and version. Returns whether recoverable setup is pending.
- `GET /admin/beta-access?page=0`: 30 verified requests per page, total, configuration readiness and intake switch.
- `PUT /admin/beta-access/settings`: `{ enabled: boolean }`.
- `POST /admin/beta-access/:id/action`: approve/resend/defer/reject/revoke/delete. Status transitions and settings changes are audited atomically. SMTP delivery status is separate from application status.

New tables: `beta_access_requests` and `beta_access_tokens`; migration `20260907060000_beta_access`. Tokens have separate purposes, secure random 256-bit values and SHA-256 hashes only at rest. They are transmitted in email URL fragments, read into transient client state and removed from the address bar. Token lookup/consumption uses POST bodies, never query parameters. Link pages have no wallet header, Turnstile, analytics or other third-party widgets, and use no-store/noindex/no-referrer headers. Do not add request-body logging to these endpoints or third-party widgets to the redemption page.

## Abuse controls and configuration

Turnstile is checked by the API using Siteverify, an explicit hostname allowlist and the `beta_apply`/`beta_resend` action. Missing keys, invalid origin, provider outage or wrong tokens fail closed. Known Turnstile test site keys are rejected in production. The honeypot writes nothing and sends nothing.

All limits are atomic in Redis: five intake attempts per IP per 15 minutes; three confirmation emails per address per day; one email per address per minute; 100 beta emails globally per hour. Admin invitations share the global and per-address spacing limits. Token endpoints allow 30 attempts per IP per 15 minutes. Keys hash IP/email; the existing trusted Express `req.ip` is used, never a manually parsed forwarded header. Redis outages never fall back to unprotected mail delivery. Global/per-email mail throttling is deliberately not disclosed through an address-specific public response.

Required API environment (placeholders only in examples):

```text
BETA_ACCESS_WEB_ORIGIN=https://desk.uliquid.vip
NEXT_PUBLIC_TURNSTILE_SITE_KEY=<public site key>
TURNSTILE_SECRET_KEY=<backend-only secret>
TURNSTILE_ALLOWED_HOSTNAMES=desk.uliquid.vip
BETA_ACCESS_PRIVACY_APPROVED=false
```

The public site key is returned by the API, so it does not need a new web build argument. Reuse configured SMTP and `API_RATE_LIMIT_REDIS_URL`/`REDIS_URL`. Do not place secrets in web environment variables, logs or commits. The existing production Compose API loads `.env.prod`; no deployment wrapper changes are required.

Create a dedicated Turnstile widget for the production hostname. Keep test credentials/local mocks outside production. Verify deployment proxy topology so clients cannot connect directly to the API and spoof the single trusted proxy hop. An administrator can enable intake only after the readiness configuration and privacy-approval flag are present. The beta setting is independent of the public-registration switch.

## Privacy and retention approval gate

Before public activation, the owner/legal reviewer must approve the actual privacy notice, processing basis, responsible entity/contact, data-subject information and Turnstile processing/transfers. The form notice is not a blanket consent or newsletter subscription. No new beta contract has been invented. Existing Terms/Privacy/Risk documents and the versioned legal-acknowledgement mechanism apply at account creation.

Prepare the public privacy addendum using these implemented facts:

- Data: email, test motivation, language, verification/review/setup timestamps and delivery result; application data is visible only to platform superadmins.
- Purposes: review requested beta access, send necessary verification/invitation messages, prevent abuse and document access decisions. No marketing use.
- Processors: existing hosting/email services and Cloudflare Turnstile for automated-abuse protection; explain the verified legal basis and applicable transfer safeguards before publication.
- Deletion: unverified requests after seven days; rejected/revoked after 30 days; pending/deferred after 90 days; completed applications after 30 days. Old invitations are removed after 90 days unless a currently valid invitation still exists. Expired token rows are removed after seven days. The minute-level cleanup cadence can add up to one scheduling interval during normal operation.
- Account legal acknowledgements remain separate; deleting an application does not delete the account or its acceptance record. Audit events keep action/actor/request ID without motivation, email, password or tokens.

Do not set `BETA_ACCESS_PRIVACY_APPROVED=true` until the approved public privacy text has been published. Existing public policy text is intentionally not silently rewritten or claimed legally sufficient by this implementation.

## Verification and release

### Local verification — 2026-09-07

Implementation is isolated on `codex/beta-access-20260907`, based on `origin/main` at `8d9f2a72c`. The original Ein UI checkout is preserved. These are local results, not deployment evidence:

- 13 beta-access tests passed with isolated PostgreSQL and Redis, including concurrent redemption, quota atomicity, token rotation, retention and fail-closed behavior. Existing auth tests: 64 passed. Ein UI contracts: 14 passed.
- The additive migration applied successfully to a locally bootstrapped baseline database; Prisma reported no schema difference afterward.
- API and web typechecks, i18n integrity and the web production build passed. The Ein UI inventory check covered 44 registry items, 54 source files and 108 routes.
- Local browser fixtures completed application, explicit email confirmation, approval and invitation redemption in Chrome, Firefox and WebKit. SMTP and bot checks were mocked; no external messages or accounts were created. Admin approval/dialog interaction was checked in Chrome; the other browsers used the local admin API fixture.
- Desktop (1440 px), 390 px and 360 px layouts were checked without horizontal overflow. Invitation email remained read-only, submission was disabled before legal acceptance, and keyboard Space toggled acceptance. Final Firefox/WebKit runs recorded no page errors or error overlays and completed on the expected Desk route.
- Browser testing identified and fixed same-document fragment navigation between verification and invitation links, including stale asynchronous response protection. Token fragments are removed from the visible URL after reading.
- Real SMTP delivery, real Turnstile challenges, production proxy configuration and actual provisioning integrations still require a separately authorized environment smoke. Local service tests use an injected provisioning fixture. Privacy approval, production migration, deployment and public activation remain open gates.

Browser automation used the local Playwright fallback because the Browser plugin was unavailable. Dependency installation reported three moderate audit findings; dependency remediation was not included in this scoped feature.

Run `npm -w apps/api run test:beta-access`. The database/Redis integration cases require explicitly supplied `BETA_TEST_DATABASE_URL` (loopback database named `beta_test`) and `BETA_TEST_REDIS_URL`; otherwise they are reported skipped, not passing integration evidence. Never point these tests at staging or production. Run existing auth tests, API/web typechecks, i18n, Ein UI guard and production build as well.

For release: review and back up, apply the forward migration with explicit authorization, deploy API and web, configure Turnstile/SMTP/Redis and publish approved privacy text, then explicitly enable beta intake while leaving public registration closed. Start with a controlled mailbox smoke. No real orders, payments or wallet operations are needed.

Rollback: close beta intake first; old code can remain compatible with the additive tables. Preserve records, token hashes and legal evidence. Do not drop tables as an automatic rollback action. Pending invitations require the new API to remain available until an approved rollback/recovery decision.
