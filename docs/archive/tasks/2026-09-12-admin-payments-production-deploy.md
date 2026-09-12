# Admin payments overview: production deployment

Date: 2026-09-12
Status: Production deployed; runtime, source and read-only database smokes passed. Authenticated browser acceptance remains open.

## Authorization and source

Mario explicitly requested committing the payment overview to main, pushing it, and redeploying production. This authorization covers the scoped application release and read-only verification; it does not authorize payments, refunds, wallet signatures, manual entitlement changes, or new schema migrations.

- Previous origin/main and production checkout: `217198169c1a2fe918b213195a559114ef3998aa`.
- Application commit: `7db64eea4c17d4050fb73d8a6f8091dc64aca8ff` (`feat(admin): add read-only payment order overview`).
- Main was fast-forwarded and pushed successfully. Only this feature commit was added to the previous remote main.
- The implementation worktree was clean after commit. The separate main worktree was clean before and after its fast-forward.
- Existing production `backups/` content was preserved. No tracked production changes were present before deployment.

## Preflight and rollback

- Production host: `uliquid-desk`; checkout: `/opt/uliquid-desk`.
- Prisma preflight reported 116 migrations and an up-to-date schema. This release changes no schema, migration, Compose definition, deployment script, or environment template.
- API, web, Python strategy service, runner, PostgreSQL, Redis and Salad proxy were healthy before the build.
- The previous API, web and Python images were tagged `uliquid-desk-<service>:rollback-admin-payments-20260912`.
- Source commit, container snapshot and a mode-600 environment backup were saved in the mode-700 directory `/opt/uliquid-desk/backups/admin-payments-20260912-predeploy`.
- The same directory contains `deploy.log`. No secrets or production customer records are copied into this repository.

## Deployment

The server fetched origin/main and verified the exact authorized application commit before fast-forwarding. Deployment command:

```sh
./scripts/deploy_prod.sh --no-pull api web
```

The standard wrapper preserves the established runtime feature overrides and builds images before updating services. Compose may include dependencies of the requested services; all service health is checked afterward.

## Verification

- Production API and web builds passed, including TypeScript, architecture checks and Next.js page generation.
- Compose rebuilt/recreated API, web and the Python strategy dependency. Runner, PostgreSQL, Redis and Salad proxy remained running. All seven services were healthy after the update.
- API startup reported `116 migrations found` and `No pending migrations to apply.`
- At 16:51:48 UTC, API, web and Python strategy service were healthy with zero restarts. The unchanged runner remained healthy with its pre-existing container uptime.
- The production checkout matched application commit `7db64eea4c17d4050fb73d8a6f8091dc64aca8ff` at runtime verification. Only the existing untracked `backups/` directory remained.
- A production database probe ran inside `SET TRANSACTION READ ONLY`. It loaded all five current orders with the deployed projection, serialized the list, loaded one detail with credit/capacity projections, and checked combined merchant/status/provider/UTC-date filters. All checks passed in 628 ms total. No identifiers, emails, amounts, or raw records were printed or retained in repository evidence. This is a bounded integration smoke, not a load benchmark or authenticated HTTP test.

| Public HTTP check without authentication | Result |
| --- | --- |
| `https://api.desk.uliquid.vip/health` | 200 |
| `/admin/billing/orders` on the production API | 401 |
| `/admin/billing/orders/nonexistent` on the production API | 401 |
| `https://desk.uliquid.vip/de/admin/licenses/payments` | 307 to `/de/login` |
| `https://desk.uliquid.vip/en/admin/licenses/payments` | 307 to `/en/login` |
| `https://desk.uliquid.vip/en/login` | 200 |

SHA-256 hashes matched between the committed local source and files inside the running web container:

| File | SHA-256 |
| --- | --- |
| `apps/web/app/admin/licenses/payments/page.tsx` | `60b2272f209c84fb48deb3636a0eca24a87080b361e65fac3c9e48ff712ff9a3` |
| `apps/web/app/admin/licenses/payments/PaymentDetails.tsx` | `69ab4bd0efd31cb634c5520d8ef36405f304006de32a91e8de4647cdf3ab9fac` |

## Remaining acceptance

The browser UI and authorization guards were covered locally. An authenticated production browser session and a non-superadmin production HTTP 403 probe remain open. Mario can open Admin > Licenses > Payments after login and compare an existing order's details. No new payment or entitlement change is needed. Large-volume query performance remains unbenchmarked.

Deployment documentation is recorded in a follow-up documentation-only commit. The application image corresponds to `7db64eea`; advancing the server checkout to that documentation commit does not require an image rebuild.

## Related evidence

- [Local implementation, file inventory and test evidence](2026-09-12-admin-payments-overview.md)
- [Active acceptance plan](../../plans/active/billing/admin-payments-overview.md)
