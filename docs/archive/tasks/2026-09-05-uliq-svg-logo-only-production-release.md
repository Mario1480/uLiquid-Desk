# ULIQ SVG logo-only production release

Date: 2026-09-05. Mario explicitly approved publishing only the logo.

- Isolated release commit: `33772ac7` (`Add ULIQ SVG token logo for explorer profile`), based on production/GitHub `f7d8df93`.
- Exactly one released file: `apps/web/public/images/tokens/uliq-token-32.svg` (32 by 32 SVG, 1,738 bytes).
- Created in an isolated server worktree, pushed to GitHub `main`, then pulled with `--ff-only` into `/opt/uliquid-desk` on `uliquid-desk`.
- The local combined ULIQ commit `2482356d` was not pushed or deployed. Local checkout history was preserved. A stalled local fetch was terminated; local remote-tracking state may remain stale.
- Production web build and TypeScript validation passed. Activated with `docker compose --env-file .env.prod -f docker-compose.prod.yml up -d --no-deps web`.
- Web container changed from `c2b22d66501e` to `3cbe02c3093e`. API `c30b14578ebd`, runner `a0fe664b7932`, Python `ba00e93e1afc`, PostgreSQL `769e97fe8bb0`, Redis `0c817ad8da83`, and proxy `06cb505da85f` remained unchanged and healthy.
- Public [logo URL](https://desk.uliquid.vip/images/tokens/uliq-token-32.svg) returned HTTP 200 with `Content-Type: image/svg+xml`; downloaded bytes matched the local source.
- SHA-256: `e3d9ac72b9949b596a477d9f53b2e6280e8c7ae84e51419335754a56f44a63d4`.
- Public API `/health` and Desk `/en/presale` returned HTTP 200 after activation.
- Server's pre-existing untracked `backups/` was preserved. No API, database, onchain, feature-gate, or environment change was performed.

Arbiscan token-profile submission remains a separate pending step. This record is local evidence, not part of the logo-only production commit.
