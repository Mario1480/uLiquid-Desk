# Ein UI local validation — 2026-09-06

Status: implementation is active locally; release acceptance remains open. No production deployment, transaction, payment, registration, migration, commit or push was performed by this task.

Subsequent release update: Mario authorized publication after this local validation task. Combined code `111b9de6e` was pushed and deployed to API/web on 2026-09-06; technical runtime checks passed. See the [release evidence](../archive/tasks/2026-09-06-einui-copilot-production-release.md). The local observations below remain historical; they do not replace the still-open post-release authenticated browser, accessibility or populated financial-screen acceptance.

## Scope and reproducibility

Baseline branch: `codex/einui-baseline-20260906` at `ff8374278`. Migration branch: `codex/einui-desk-integration`. A detached temporary baseline checkout was built with its own lockfile. Both builds used Node 20.20.2, Next 16.2.12, React 19.2.3 and the same loopback API fixture. Both needed the documented compile-only Dashboard field-copy correction. The website source remains clean and unchanged.

The working checkout also received unrelated concurrent Agent Chat/Position Copilot and documentation edits. They were preserved, not reverted or included in a migration commit. The final build and bundle results describe the combined checkout; the deltas cannot be attributed exclusively to Ein UI until an isolated integration branch has been reconciled.

## Automated checks

| Check | Result |
|---|---|
| Registry and original source coverage | 44 registry entries, 54 retained source files; all paths present |
| Desk snapshot hashes | All files in `components/einui/desk-files.json` verified |
| Route inventory | 107 page files; direct/transitive adapter coverage recorded |
| Import isolation | No gallery/templates in product route source graphs; no gallery/widgets/templates/innovative modules in measured production client manifests |
| Web production build | Passed; compilation 9.7 s, TypeScript 13.7 s, 98 static pages generated |
| Web typecheck | Passed after final component edits |
| i18n integrity | Passed |
| Ein UI native contracts | 6/6 |
| Trade prefill | 5/5 |
| Predictions UI | 4/4 |
| Bot controls | 4/4 |
| Grid catalog | 2/2 |
| Billing | 8/8 |
| i18n routing | 6/6 |
| Agent Chat UI | 9/9 |
| ULIQ admin | 25/25 |
| Dashboard API/layout/widget tests | 27/27 |
| Vendor chart checksums | Passed, 1,949 files |
| Whitespace/diff check | Passed |

Two failures were reproduced in the unmodified baseline and are not migration regressions: `test:api-base` expects three cookie keys while the implementation returns five (9/10 pass); `quality:any-budget` reports exchange 73 against a budget of 72. These remain open; they are not silently waived.

## Browser evidence

- Chrome, Firefox 155 and WebKit 26.5: gallery and modal viewport checks at 1440, 768, 390 and 360 px. No horizontal document overflow; modal bounds and Escape behavior checked.
- Native macOS Safari: private-window local fixture, login field interaction, gallery selection, dialog focus, Escape and focus return. This is desktop Safari evidence, not an iOS Safari device test.
- All 46 examples mounted without JavaScript page errors: 44 registry entries, website Dashboard template, and Desk native contract harness.
- Native decimal string `0.00000001`, side selection, note and form submission retained their exact values; forwarded input ref focused the field.
- Admin confirmation returns focus, closes on Escape normally, and remains open on Escape while pending. The local completion closes it without a real request.
- The existing-layout Desk dialog adapter focused its input and returned focus to its trigger on Escape.
- Command Palette empty-result keyboard handling and selection, and Spotlight Escape were exercised.
- A Forest preview dialog inherited `--ein-color-cyan-500: #10b981` through its portal; Reduced Motion produced `animation-name: none`.
- A non-admin fixture was redirected away from the gallery. The authorized gallery returned `noindex, nofollow`.
- Product login, Dashboard, Trading, Wallet and Settings screenshots were captured before/after. Authenticated product examples use intentionally incomplete, local read-only fixtures. Missing-fixture HTTP errors and empty/error states are expected and are not successful account-data acceptance.

Screenshots were retained as local QA artifacts under `output/playwright/einui-*`, including gallery, Chrome/Firefox/WebKit responsive checks and before/after product screens. They are not distributed in the source release; the observations above record their scope and limitations.

## Bundle and local runtime measurements

[Raw production asset measurements](einui-bundle-measurements.json) count unique initial JS/CSS referenced by Next client manifests, with gzip applied per file. They are not observed network transfer or a claim that every referenced module executes immediately.

| Route | Additional initial JS, gzip bytes | Additional CSS, gzip bytes |
|---|---:|---:|
| Dashboard | 75,573 | 15,128 |
| Login | 34,375 | 15,128 |
| Trading | 35,773 | 15,128 |
| Bots | 34,821 | 15,128 |
| Agent Chat | 84,499 | 15,128 |
| Settings | 44,012 | 15,128 |
| Wallet | 44,555 | 15,128 |
| ULIQ | 34,568 | 15,128 |
| Admin System | 34,395 | 15,128 |

One local warm-browser sample, same desktop viewport and loopback fixture:

| Page | Load event before / after, ms | Maximum of 20 scroll frame intervals before / after, ms |
|---|---:|---:|
| Login | 265.8 / 259.2 | Not measured |
| Dashboard | 100.5 / 84.8 | 11.9 / 14.2 |
| Trading | 84.7 / 156.7 | 15.4 / 9.9 |
| Wallet | 129.0 / 121.3 | 10.3 / 9.9 |
| Settings | 123.0 / 160.9 | 10.0 / 13.1 |

Two automated login field fills took 28 / 7 ms before/after. These are coarse automation timings, not INP, percentile performance, sustained scrolling, or production Core Web Vitals. Cache, request errors, host load and concurrent changes limit interpretation. No horizontal overflow was observed in these samples. Do not infer a performance improvement from a single sample.

## Remaining release acceptance

1. Review the visuals with Mario, especially dense surfaces and existing specialized controllers.
2. Exercise representative populated account, Trading, Bot/Grid, Billing, Funding, Wallet and ULIQ states with local/mocked business fixtures: sort/filter/sticky behavior, long German copy, pending recovery and responsive dialogs. Existing business tests and native adapter checks do not cover every screen state.
3. Complete screenreader, text/control contrast, unsupported-backdrop and resize/rotation acceptance across the target matrix. Reduced Motion and portal checks passed, but they are not a full accessibility audit.
4. Run repeatable performance measurements on populated Trading/AI screens and an isolated reconciled branch, including request counts, layout shifts and sustained scroll. The current smoke is not a release performance gate.
5. Reconcile the diverged branch and concurrent changes without losing user work; repeat release checks. Obtain explicit deploy approval and rebuild with authorized production environment values. Never deploy the loopback QA build.
