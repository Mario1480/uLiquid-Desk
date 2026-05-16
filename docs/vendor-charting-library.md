# Vendored Charting Assets

Last reviewed: 2026-05-15

The web app vendors TradingView Advanced Charts assets under:

- `apps/web/public/static/charting_library`
- `apps/web/public/static/datafeeds`

## Inventory

- Library: TradingView Charting Library / Advanced Charts
- Version marker: `CL v31.0.0`
- Internal package id: `028f81fbf6fef55e9694e5df4bd5106cc04c188a`
- Package timestamp: `2026-03-05T20:44:53.566Z`
- Version source: `apps/web/public/static/charting_library/package.json`
- Static bundle checksum: `e763cfce0f8343f413494171a38783e69b90fe94cda92ae99fe1a9a9b0088d1c`

Checksum command:

```bash
git ls-files -z -- apps/web/public/static/charting_library apps/web/public/static/datafeeds \
  | xargs -0 shasum -a 256 \
  | shasum -a 256
```

## Handling Rules

- Treat these assets as third-party vendored code, not application source.
- Do not modify generated bundle files directly.
- Updates must record the new upstream package/version marker, checksum, and date in this document.
- Confirm the project has the necessary TradingView Charting Library license/access before copying or redistributing updated bundles.
- Keep the assets out of regular TypeScript and lint scopes unless a dedicated vendored-asset check is intended.
