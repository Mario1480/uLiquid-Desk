# Ein UI integration

Status: published and deployed to production API/web on 2026-09-06 at code `111b9de6e`, following Mario's approval to release UI and Copilot corrections together. Runtime checks passed; post-release authenticated browser acceptance remains open because the Mac was locked. See the [release evidence](../archive/tasks/2026-09-06-einui-copilot-production-release.md) and [validation report](einui-validation.md) for results and limitations.

## Approved scope

Adopt the complete website-adapted Ein UI collection, use suitable primitives throughout Desk, keep Ocean colors and solid buttons, and activate migrated surfaces without a feature flag. Preserve routes, permissions, data flows, financial precision, pending states, information density and chart implementations. This replaces the earlier dashboard-only pilot. Native iOS/Android are outside this web migration.

## Baseline and provenance

- Desk baseline: `ff8374278`, preserved by `codex/einui-baseline-20260906`.
- Work branch: `codex/einui-desk-integration`. Initial main was ahead 7 / behind 8. No pull, reset, merge, push or deployment was performed.
- Website source: `/Users/marioeuchner/Documents/uLiquid Desk Website/workspace/site-v2/components/einui`.
- Website revision: `9c93095450a25617d89328db9cbb76a56987b9ca`.
- Upstream: [Ein UI](https://github.com/einui/einui), commit `d3b4f19012e1af6a9696f028c015aa2da2d386dc`, MIT source license.
- Original file hashes and website adaptations: [source manifest](../../apps/web/components/einui/source.json), [registry](../../apps/web/components/einui/registry.upstream.json), [license](../../apps/web/components/einui/LICENSE).
- Completeness is checked against registry paths and the source manifest, not a hardcoded file count.
- Current adopted file hashes and Desk changes are recorded in [desk-files.json](../../apps/web/components/einui/desk-files.json); the verifier detects unreviewed drift.
- Website-only Gallery, ThemeSelect, SiteSurface and theme wiring are replaced by Desk equivalents. The website remains read-only input.
- Unrelated work, including documentation produced concurrently, is preserved.

## Architecture

Tailwind v4 is integrated through PostCSS without Preflight. Utilities and Tailwind variables use the `ein` prefix, including responsive, group, state and animation variants. The `cn` merge configuration uses the same prefix. Source scanning is restricted to Ein and Desk components. shadcn aliases are recorded in `apps/web/components.json`.

Dependencies are pinned in the web package and lockfile. Existing Next 16.2.12 and React/React DOM 19.2.3 resolutions were retained. Components are imported directly. Gallery groups and templates load dynamically after the existing admin access check. Normal route dependency graphs and production client manifests are checked for gallery, widget and template leakage.

The library retains website corrections for Slot/asChild, semantic elements, badges, breadcrumbs and Motion imports. Desk adaptations add solid buttons, native-layout modes, prefix isolation, portal themes, accessible modal/command behavior, local pricing fixtures and CSS-only skeletons.

## Ocean and button policy

| Token | Value |
|---|---|
| Navy | #040817 |
| Cyan | #24E6F2 |
| Blue | #3478FA |
| Violet | #8854F6 |
| Magenta | #DC48F5 |
| Ice | #B7FAFF |

Ocean is fixed in the application. Aurora and Forest are confined to gallery previews and their portals. Primary actions use solid #2865DC, a darker Ocean-blue shade with suitable contrast for normal white labels. Start, Pause and Stop retain solid semantic colors. Product buttons have no gradient, decorative glow, ripple or scale effect. RippleButton is a solid compatibility alias; the decorative Ripple surface remains available.

Cards use the website material. Dense financial/admin surfaces use a more opaque background without backdrop blur. Existing semantic status colors, numeric typography and information density remain. Reduced Motion and unsupported-backdrop fallbacks are limited to Ein surfaces.

## Native compatibility adapters

- Button: native type, form, disabled, accessibility attributes, handlers and ref, without wrapper div/span.
- Input/textarea/select: native events and values, including empty and decimal strings; no onValueChange conversion.
- Table: native table structure; existing scroll container, sticky header, filters, sorting and responsive behavior retained.
- Surface: Slot retains the original section/article/div and its child hierarchy.
- Badge: native span with existing semantic classes.
- Dialog: existing content/backdrop styles and close callbacks retained; Ein/Radix supplies portals, focus trap, Escape, scroll lock and focus return. Existing pending guards remain authoritative.
- Specialized tab controllers retain their mount/unmount and request behavior; their controls and theme are migrated.

The [route inventory](einui-route-inventory.md) covers every page. Charting, calendar controllers, dense/virtualized lists, wallet interactions, auth, checkout, admin and execution logic are not replaced by demo templates.

## Internal gallery

`/admin/system/ui-components`, with normal locale prefixes, inherits existing System-admin proxy protection. It checks access again before loading examples and declares noindex/nofollow. Admin System links to it.

Every registry component has a runnable example. The website dashboard template and a native-form/modal contract harness are included. Widgets explicitly use illustrative data. Template submissions and links are intercepted locally; no checkout, account creation, order or message is sent. Only the selected example mounts; hidden/inactive previews unmount animation loops. Theme context propagates to portals.

## Validation and reproduction

```sh
node scripts/verify_einui.mjs
npm -w apps/web run test:einui
npm -w apps/web run typecheck
npm -w apps/web run i18n:check
npm -w apps/web run build
node scripts/measure_einui_bundles.mjs BASELINE_CHECKOUT
```

For isolated UI QA, run `node scripts/einui-mock-api.mjs`, configure API URLs to the loopback fixture and run `next dev --hostname localhost --port 3301`. The fixture rejects mutation methods. Browser sessions use dummy local cookies and block non-loopback requests. These tests do not represent production authentication or authorize live capital actions.

A pre-existing Zod/non-strict TypeScript error in the Dashboard layout consumer was reproduced in the baseline. Explicitly copying the already validated fields fixes compilation without changing schema, API contract or values. The comparison baseline receives the same compile-only correction.

## Acceptance and release gates

- [x] Registry/source/license coverage, dependency lock and isolated prefix.
- [x] Native adapters and route inventory, no feature flag.
- [x] Interactive gallery, local fixtures and portal themes.
- [x] Production-mode compilation and web TypeScript validation observed.
- [x] Native form/ref and pending-dialog behavior exercised locally.
- [x] Chrome, Firefox and WebKit at desktop/tablet/390/360 widths exercised.
- [x] Final build, typecheck, test and bundle evidence refreshed after component edits.
- [x] Native desktop Safari form/dialog/focus smoke.
- [ ] Populated account/financial screen regression matrix, full accessibility and sustained performance acceptance.
- [x] Reconcile concurrent UI/Copilot changes on `origin/main`, retaining the published Dashboard fix and excluding older unpublished ULIQ history. Local bundle numbers still describe the original combined checkout.
- [x] Mario approved the UI as ready and explicitly authorized the combined commit, push and deployment on 2026-09-06.

Report baseline-only failures separately; do not silently waive them. Rebuild release artifacts using the authorized environment, never deploy a mock-API QA build. Rollback uses the previous web artifact or reviewed migration reverts, not a destructive reset of the diverged checkout.
