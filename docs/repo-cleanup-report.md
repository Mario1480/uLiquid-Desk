# Repo Cleanup Report

Date: 2026-03-16

## Scope

This cleanup pass focused on conservative repository normalization before deeper feature work:

- remove clearly stale duplicate source files
- remove tracked generated artifacts and backup output
- harden ignore rules so the same debris does not get recommitted
- normalize the root workspace package slug from legacy `market-maker` naming to `uliquid-desk`

## Removed

### Stale duplicate source files

The following duplicate source files were removed after comparing them with the active canonical files:

- `apps/web/app/admin/page 2.tsx`
- `apps/web/app/components/AppHeader 2.tsx`
- `apps/web/lib/web3/config 2.ts`
- `apps/api/src/billing/ccpayment 2.ts`

### Tracked generated artifacts

The following tracked generated output was removed:

- `apps/web/.next.bak.1770923897/` backup build tree
  - contained 160 tracked Next.js build artifact files
- `apps/py-strategy-service/__pycache__/models.cpython-314.pyc`

## Consolidated

No automatic code merges were applied into runtime files during this cleanup. Each duplicate file differed materially from the active canonical version, so the conservative choice was to keep the active file and remove the alternate copy.

Canonical files retained:

- `apps/web/app/admin/page.tsx`
- `apps/web/app/components/AppHeader.tsx`
- `apps/web/lib/web3/config.ts`
- `apps/api/src/billing/ccpayment.ts`

## Branding normalization

Safe root-level branding normalization applied:

- root workspace package name changed from `market-maker` to `uliquid-desk`
- matching root entries in `package-lock.json` updated to keep lock metadata aligned

Intentionally not changed in this pass:

- internal workspace package scopes such as `@mm/*`
- deployment/runtime paths and defaults that may still be relied on externally

## Manual review

These items were intentionally not auto-merged and should be reviewed manually if they contained intended work:

- `apps/web/app/admin/page 2.tsx`
  - duplicate contains a very different inline admin implementation for users, Telegram, exchanges, and SMTP
- `apps/web/app/components/AppHeader 2.tsx`
  - duplicate appears to be an older/simpler header variant with different branding and fewer current features
- `apps/web/lib/web3/config 2.ts`
  - duplicate uses older WalletConnect metadata (`uTrade Panel`) and different connector behavior
- `apps/api/src/billing/ccpayment 2.ts`
  - duplicate is a simplified env-only CCPay integration; canonical file includes DB-backed secret resolution and caching

Additional legacy naming that remains on purpose:

- `scripts/backup_db.sh` still defaults to `/opt/market-maker/backups`
  - left unchanged because renaming a deployment path could break existing hosts; update separately if infrastructure is ready

## Guardrails added

`.gitignore` now explicitly ignores:

- Next.js build output and backup folders
- Turbo and TypeScript build cache files
- Python cache directories and bytecode
- common editor/patch residue such as swap, reject, and orig files
