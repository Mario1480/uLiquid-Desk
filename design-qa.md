# Prediction Builder Design QA

## Source visual truth

- `/Users/marioeuchner/.codex/generated_images/019ff4ef-1d67-7bb2-a572-fb04f17bc96c/exec-7bfd6d27-e16b-443a-86c0-f916330bca75.png`
- `/Users/marioeuchner/.codex/generated_images/019ff4ef-1d67-7bb2-a572-fb04f17bc96c/exec-580bd7bb-6d10-4e95-9bfb-8bd6a7252443.png`
- `/Users/marioeuchner/.codex/generated_images/019ff4ef-1d67-7bb2-a572-fb04f17bc96c/exec-8a965140-7453-4950-a001-fe647582894a.png`

The three images are treated as the Idea, Rules and Data, and Review and Save states of one flow.

## Implementation evidence

- Intended route: `http://localhost:3000/de/strategies`
- Intended viewport: 1440 x 1024 CSS px at device scale factor 1
- Implementation screenshot: unavailable
- Local verification copy: `/tmp/uliquid-builder-qa.ZQC4dT/repo`

## Build and interaction state

- The first local render exposed a missing built workspace dependency, `@mm/core/dist/env.js`.
- `packages/core` and `packages/futures-core` were built in the temporary QA copy.
- Web typecheck passed.
- i18n integrity check passed.
- The production web build passed with explicit local API environment values.
- A read-only mock API was used for the intended Idea to Rules to Preview test flow; it wrote no product or production data.
- After the dependency fix, the Browser URL policy blocked reload, DOM inspection, screenshots, and interaction checks for the local route. No browser fallback or policy workaround was attempted.

## Fidelity surfaces

- Fonts and typography: implementation uses the existing uLiquid system font stack and compact hierarchy. Browser comparison is blocked.
- Spacing and layout rhythm: implementation follows the three-column stepper and 60/40, wide-plus-rail layouts from the source. Browser comparison is blocked.
- Colors and visual tokens: implementation exclusively uses existing uLiquid surface, border, accent, status, radius, and shadow tokens. Browser comparison is blocked.
- Image and asset fidelity: the design contains no new raster assets. Existing `AppIcon` vocabulary is used for all UI icons.
- Copy and content: visible flow labels are localized in German and English; i18n integrity passed.

## Findings

- [P1] Browser-rendered fidelity and primary interactions remain unverified.
  - Location: `/de/strategies`, all three builder states.
  - Evidence: the Browser URL policy rejected further access to the local QA route after the initial dependency issue was fixed.
  - Impact: layout overflow, exact visual drift, and step interaction behavior cannot be confirmed from browser evidence.
  - Fix: open the running local QA route in a user-controlled browser or rerun Browser QA when the local URL policy permits it, then capture all three states at 1440 x 1024 and one mobile state.

## Comparison history

1. Initial render: blocked by missing `@mm/core/dist/env.js`.
2. Fix: built `packages/core` and `packages/futures-core` in the local QA copy.
3. Post-fix evidence: typecheck, i18n, and production build passed; visual recapture was blocked by Browser URL policy.

## Primary interactions still to verify

- Open a saved template and move from Idea to Rules and Data.
- Search, expand, add, and remove indicators.
- Request a preview and reach Review and Save.
- Save against the local mock and observe the saved state.
- Check responsive collapse below 1100 px and 700 px.
- Confirm no relevant console warnings or errors after the successful render.

final result: blocked
