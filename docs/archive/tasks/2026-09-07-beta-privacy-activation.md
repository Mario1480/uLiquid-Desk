# Beta privacy publication and intake activation

## Authority and scope

Mario explicitly approved supplementing and publishing the beta privacy information and enabling beta applications on 2026-09-07. This records operator approval, not an independent legal opinion or certification of the entire privacy policy. Existing public registration must remain disabled.

## Publication

- Privacy Policy version `2026-09-07` adds application data and purposes, human review, operational retention periods, necessary communications, GDPR bases where applicable, Turnstile processing and provider roles, international-processing disclosure, and privacy contacts/rights.
- Cookie information version `2026-09-07` adds the Turnstile disclosure in German and English. Existing privacy-policy content remains English on both locale routes.
- Existing product terms and risk-acknowledgement text/version/hash are unchanged: the new text describes the application workflow and does not introduce a beta contract or rewrite prior acceptance records.
- Source references: [Cloudflare Turnstile Privacy Addendum](https://www.cloudflare.com/turnstile-privacy-policy/), [GDPR Article 6](https://eur-lex.europa.eu/eli/reg/2016/679/art_6/par_1/pnt_f/oj), and `apps/api/src/auth/betaAccess.ts` / `betaAccessSecurity.ts` for implemented behavior. External sources were checked on 2026-09-07.

## Release sequence

Publish the web changes before setting `BETA_ACCESS_PRIVACY_APPROVED=true`. Recreate only API to load this flag, then enable `auth.beta-access.v1` through the authenticated superadmin settings UI so the normal audit path records the change. Do not enable public registration or create an applicant/account for the smoke.

Rollback: turn beta intake off in the same settings UI; reset the privacy flag if the published notice is withdrawn. Keep records and tokens intact. No migration or data deletion is part of this release.

## Verification

- Web typecheck, i18n integrity and all 14 Ein UI contract tests passed. Local production build passed with an explicitly configured public API URL; the first attempt correctly failed closed when this required local environment value was absent.
- Publication commit: `ffb66d617`, pushed to `origin/main`. The previous production web image was tagged `uliquid-desk-web:before-beta-privacy-20260907` before building the replacement.
- Production Docker web build passed. Published only web, then recreated only API to load the privacy flag. No migration was pending among 115 migrations. Brief startup 502 responses cleared; API health recovered.
- Published HTML and Chrome showed version `2026-09-07`, beta retention and Turnstile sections. Desktop and 390 px privacy rendering had no horizontal overflow or framework overlay. The only observed Chrome error came from a wallet extension (`Cannot redefine property: ethereum`).
- Enabled the authenticated superadmin toggle through the regular audited API. Public endpoints confirmed beta `enabled: true` and public registration `enabled: false`.
- The unauthenticated in-app browser displayed the German application form, privacy link and real Turnstile widget with automatic success; its error log was empty. No CAPTCHA was manually solved and no application or email submitted. Full SMTP delivery/server-side submission and invitation redemption remain untested in this live smoke.
- Final container IDs: web `654c2b07cfd8`, API `4dad08ec01f7`, both healthy. Runner, PostgreSQL, Redis, Python strategy and proxy IDs were unchanged. Environment backups remain root-only outside Git.
