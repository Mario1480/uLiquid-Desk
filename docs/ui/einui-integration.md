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

## Follow-up adoption sweep (2026-09-06)

Mario requested a second source-wide pass after production screenshots exposed the mobile search alignment and partial badge adoption. This follow-up is local and has no deployment authorization.

- Replaced 239 individual legacy badge/chip spans with the shared DeskBadge/GlassBadge adapter, plus the common StatusBadge adapter. Native layout now applies actual Ein material, not just a compatibility class. Existing success/warning/error, Long/Short and subscription lifecycle meanings remain mapped to semantic tones.
- Replaced 90 button-styled Next links and 21 external action anchors with Ein Slot-based adapters. URLs, locale paths, navigation, prefetch, download, target, rel and event props remain owned by the existing links.
- Applied the Ein form material to native Desk selects and controls without converting native events to Radix value callbacks. Checkboxes/radios retain native validation, checked state and submission behavior with Ocean accents.
- Login, Sign Up/email verification and password reset now use an adapted composition from the Ein auth blocks: centered card, icon/title header, full Ein inputs/buttons and stacked actions. Legal notices remain visible below the form card; registration consent remains required. No demo social providers, invented name fields or simulated auth logic were added.
- Authentication submit, SIWE, resend and reset handlers were compared against the pre-sweep Git revision and are unchanged. Errors now expose alert semantics and status text exposes a live status role.
- The search submit button now uses top/bottom inset plus auto margins, not a transform that the solid-button policy disables. This keeps placement separate from visual animation policy.
- The route inventory includes the added Badge, Link and Anchor dependencies. The verifier rejects newly introduced named legacy status spans and button-styled raw links, in addition to registry/hash/import checks.

### Deliberately retained specialized interfaces

| Interface | Reason |
|---|---|
| Charts, order books, virtualized/scrollable data regions | Existing rendering, precision and performance ownership; no equivalent generic template replacement |
| Product tabs and query-driven selectors | Keep mount behavior, keyboard/business state and request timing |
| Native number/select/checkbox/radio controls | Preserve intermediate values, browser form validation, events and disabled/required semantics |
| Wallet connection, SIWE, registration gates, checkout and capital dialogs | Existing integrations and permission/transaction lifecycles; templates supply presentation only |
| Header account/credit indicators and navigation menus | Existing semantic controls and live content retained; shared material/icons and existing Ein adapters apply |
| Funding direction rows and chip containers | Structural layouts rather than standalone badge values |

This inventory describes source adoption, not acceptance of every populated account or capital-flow state. The earlier release gates remain applicable. Follow-up browser checks use loopback fixtures and intercepted local auth responses, never real registration, password changes, orders or payments.
### Follow-up validation

- Build and web typecheck passed after the sweep (Next compilation 8.1 s, TypeScript 12.1 s). i18n integrity passed. The nine targeted web suites passed all 72 tests, including new badge-tone, auth-composition and action-link contracts.
- Chrome: search button center offset 0 px, contained within its field, and no horizontal overflow at 360/390/768/1440 px. Search suggestions still appear and Escape closes the list.
- Fresh WebKit: search center offset 0 px and no overflow at 360/390 px; German login also rendered without overflow. An older long-lived WebKit session had served pre-fix CSS; a fresh session confirmed the actual updated stylesheet behavior.
- Fresh Firefox: production-mode login and search at 390 px without overflow or JavaScript page errors; search center offset 0 px.
- Login: exact local credentials payload retained; simulated email-not-verified response displays the error and verification link. No account was accessed.
- Registration: consent gate, referral payload, locked verification email and six-digit input retained; disabled registration hides registration fields. The responses were intercepted locally, with no registration or email sent.
- Reset: request payload retained; mismatched confirmation prevents a confirm request; matching values send the original code/newPassword payload to an intercepted local endpoint only.
- Auth desktop card width is 480 px; mobile card fits at 390 px. Production-mode German login had no JavaScript page errors. Expected mock HTTP errors and blocked external wallet resources are not production-flow acceptance.
- Registry, current file hashes, source sweep, route imports and production client-manifest isolation passed. Relative to the first stored asset snapshot, the measured routes add 671 gzip CSS bytes; their initial JS asset totals do not increase. This is an asset comparison, not a runtime performance claim or an isolated attribution of intervening work.

Live deployment, native iOS Safari acceptance, real SIWE signatures, populated capital flows and the broader release matrix are not part of these local follow-up smokes.

## Material unification (2026-09-06, local follow-up)

Mario approved a single Ein material system and an update of the local UI skill.

- The editable source is now `apps/web/components/einui/materials.css`: `--glass-bg`, `--glass-border`, `--glass-blur`, control, shadow and fallback tokens.
- Default surfaces use neutral white at 10% opacity and 20px blur. Controls use 12% white. `glass-light` uses 4% white/12px blur; `glass-solid` uses Navy at 94% opacity/20px blur for readable dense panels and overlays. These are deliberate Desk adaptations, not literal copies of the documentation sample. Apply variants to the actual Ein element, not a wrapper.
- Per-card Ocean gradients and redundant auth/input material overrides were removed. Card glow is off by default; an explicitly requested glow is neutral. Full and native input/textarea paths carry the same material marker. Dialog, alert dialog, sheet, select, popover and tooltip panels use the shared solid material.
- The narrow `ein-material` cascade layer protects background, shadow and blur from legacy component classes. Important declarations are restricted to material/focus ownership; legacy positioning, dimensions and transforms are not layered or overridden. This compatibility boundary is intentional while legacy layout CSS remains.
- Buttons remain single-color and status tones retain their meanings. This is not a claim that all specialized widget/graph styles have been rewritten.
- The local `apply-uliquid-ui-design` skill, its web rules and invocation metadata now require actual Ein primitives/Desk adapters and central material tokens. AGENTS.md is aligned. The skill lives outside this Git repository and will not be distributed by a Desk commit.

### Validation and limits

- Ten Ein contract tests, i18n integrity, web typecheck and production build passed. Registry/source/import checks pass with original website hashes preserved. Skill validation passed.
- Chrome login at 1440px/360px: no horizontal overflow; computed Card background rgba(255,255,255,0.1), no background image, 20px blur. Both inputs use rgba(255,255,255,0.12); keyboard focus has a 2px Cyan outline.
- Firefox and WebKit at 390px render the same Card values without horizontal overflow. WebKit reduced-motion smoke and light/solid variant computed values passed. This is browser-engine testing, not native iPhone hardware acceptance.
- Chrome fixture Dashboard at 360/390/1440px: adopted surfaces have no background image, header remains sticky, search button center offset is 0px, no horizontal overflow. Fixture data endpoints intentionally return 404/405 for unconfigured/forbidden calls; populated dashboard and capital-flow acceptance remain open.
- Gallery dialog: shared solid background, 20px blur, focus inside on open, Escape closes, and focus returns to the trigger after close animation. Gallery sample inputs were also switched to GlassInput.
- Screenshots for this local run: /tmp/einui-material-login-desktop.png, /tmp/einui-material-login-mobile.png, /tmp/einui-material-webkit.png, /tmp/einui-material-firefox.png and /tmp/einui-material-dialog.png. The dialog screenshot precedes the sample-input adapter cleanup.
- Unsupported-backdrop fallback is implemented; an actual unsupported browser was not available for acceptance. Full contrast, screenreader, populated financial-flow and performance acceptance remain open. No production deployment, real account action, transaction, registration or message was performed.

## Full standard-control adoption (2026-09-06, local follow-up)

Mario explicitly requested actual Ein controls instead of merely styled native inputs.

| Control | Current product source coverage | Implementation |
|---|---|---|
| Select | 177 DeskSelect call sites | GlassSelect trigger, grouped items and portal; native select retained invisibly for real change events, values, required validation and select refs |
| Checkbox | 77 call sites | DeskCheckbox / GlassCheckbox; form selections and consent remain checkboxes |
| Switch | 42 call sites | DeskSwitch / GlassSwitch for boolean settings; no change to when settings are saved |
| Radio | 4 groups, 5 item declarations including mapped items | GlassRadioGroup and GlassRadioGroupItem; existing selection callbacks retained |
| Compact choices | 9 groups, 16 item declarations including mapped items | Ein radio-based segmented controls; no data-panel remounting or new queries merely on render |
| Slider | 2 product call sites | GlassSlider, original ranges and steps; numerical precision inputs unchanged |
| Progress | 1 native progress replacement | GlassProgress now forwards max/value correctly and calculates the visual ratio |
| Buttons and links | 467 DeskButton, 90 DeskLink, 21 DeskAnchor declarations | Shared Ein variants own material; legacy classes retain dimensions/visibility, including hidden admin toggles |
| Badges | 240 DeskBadge declarations | Existing shared Ein badge and semantic tones retained |

Counts describe JSX declarations outside Ein/Desk implementation directories, not runtime instances or measured user coverage. Input/textarea, table, card, dialog, skeleton, avatar, breadcrumb and header tooltip adoption was inspected as well. The admin sidebar surface was additionally migrated.

### Explicit specialized exceptions

- Charts, chart tooltips, order books and market visualizations retain their financial semantics, rendering and virtualized/scroll behavior.
- Date/time, numeric-precision, password and file fields use the corresponding native input behavior through GlassInput/DeskInput; the calendar widget is not a drop-in date-picker replacement.
- Genuine route navigation remains links; query-driven page routing and complex existing panel controllers are not replaced with a demo Tabs block. Segmented filters now use single-choice semantics rather than incomplete tablist markup.
- Native details/disclosures, pagination logic, persistent legal/transaction notices, custom search and symbol selectors remain where Ein has no equivalent behavior. Their existing adopted buttons/surfaces are retained. Native title metadata on timestamps and chart values is not converted into focusable decorative controls.
- Demo/gallery implementation details and the original full library stay available. This is not a claim that every native HTML element in upstream demo code was rewritten.

### Regression protection and checks

- The source verifier now rejects raw button/input/select/textarea/progress tags in product JSX and DeskInput checkbox/radio/range regressions. Original upstream/website provenance remains unchanged; reviewed Desk hashes are refreshed separately.
- 14 Ein contract tests plus the eight targeted prefill, prediction, bot, grid catalog, billing, routing, Agent Chat and ULIQ suites passed: 77 tests total. Production build and i18n integrity passed; TypeScript also passed during the migration.
- Chrome 1440px: actual dropdown selects Short exactly once; required consent and empty required selection block submit; select ref focuses the visible trigger; checkbox/switch/radio/slider values appear correctly in FormData. Decimal 0.00000001 remains exact. Arrow selection and slider increments were verified.
- Firefox and WebKit 390px: the same local contract form successfully submits consent/on, enabled/on, mode/auto and side/short with one select change. No horizontal overflow. These are browser-engine checks, not native iPhone hardware acceptance.
- Actual settings/notifications at 360px: manual timezone radio and daily-calendar switch update their local state; the language dropdown opens and Escape closes it without overflow. Fixture API has no real account data and returned expected 404s for settings/alerts, mobile-push and subscription notifications. No settings were saved.
- Browser plugin was unavailable; regular Playwright was used. No framework error overlay or JavaScript runtime error was observed in the tested final flows; expected fixture HTTP errors are not production acceptance.
- Screenshots: /tmp/ein-controls-desktop-final.png, /tmp/ein-controls-firefox-390.png, /tmp/ein-controls-webkit-390.png, /tmp/ein-controls-settings-dropdown-360.png.
- Relative to the first stored post-integration asset snapshot (not an isolated per-commit baseline), initial gzip JS increased by about 22.7 kB on Dashboard, 65.7 kB on Trading and 55.2 kB on Wallet; CSS increased by about 1.2 kB. This is summed manifest asset size, not measured transfer/interaction time. Product manifests exclude gallery, blocks, widgets and innovative demo modules.
- Full populated capital-flow, screenreader, contrast matrix and sustained performance acceptance remain open. No API/schema/runner changes, dependencies, production actions, commit, push or deployment were performed for this follow-up. Rebuild with the authorized real environment before any later deployment; never deploy this mock-API QA build.
