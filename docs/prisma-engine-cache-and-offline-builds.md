# Prisma Engine Cache And Offline Builds

Last updated: 2026-05-16

The v18 review correctly called out that `npx prisma generate` can fail in restricted environments if Prisma engine binaries are not already available. The normal CI path is online and now caches Prisma engines, but restricted or air-gapped environments need an explicit policy.

## Current CI Policy

`.github/workflows/release-gates.yml` runs on Node 20 and performs:

1. `npm ci`
2. `npx prisma generate`
3. `npm run build`
4. `npm run typecheck`

The workflow caches:

- `~/.cache/prisma`
- `node_modules/.prisma`
- `node_modules/@prisma/engines`

The cache key includes `package-lock.json` and `prisma/schema.prisma`, so dependency or schema changes refresh the cache.

## Release Evidence

For every release tag, attach evidence for:

- successful `npx prisma generate`
- successful `npm run build`
- successful `npm run typecheck`
- whether the run used a restored Prisma cache or downloaded fresh engines

If the cache misses but the run succeeds online, the release is acceptable. If the cache misses and engine download fails, treat the gate as infrastructure-blocked, not code-green.

## Restricted Network Deployments

For restricted VPS or offline builds, do not rely on a late `prisma generate` download. Use one of these approaches:

1. Build artifacts in an online CI runner, then deploy the resulting Docker images or build output.
2. Pre-warm the Prisma engine cache on the target before running release gates.
3. Mirror/cache Prisma engine binaries in the build environment and verify `npx prisma generate` before deployment.

Minimum preflight on the target:

```sh
npm ci
npx prisma generate
npm run build
npm run typecheck
```

If `npx prisma generate` cannot reach Prisma's binary host and no cache exists, stop the deployment and restore/build from an environment with pre-warmed engines.

## Docker Notes

Production Docker builds should keep Prisma generation early in the build. A failure during `npx prisma generate` must fail the image build rather than surfacing later at API startup.

When changing Prisma versions or `prisma/schema.prisma`, expect the engine cache to invalidate and confirm a fresh green CI run before tagging.
