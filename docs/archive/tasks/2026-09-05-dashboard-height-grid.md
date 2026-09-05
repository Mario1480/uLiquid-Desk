# Dashboard height grid

Date: 2026-09-05

## Implementation

- Desktop frames use saved width/height spans in a 12-column CSS grid with
  96-pixel rows and 12-pixel gaps. Normal and edit views share the same geometry.
- Vertical pointer resizing now uses the 108-pixel row pitch, including the gap.
- Sequential grid placement preserves visual order instead of densely moving
  later widgets into earlier gaps.
- Cards fill their frames. Existing scroll areas contain long lists, with a
  scrollable panel fallback for other content. Mobile cards retain natural height.
- No layout schema, saved preference, default size, API, or trading behavior changed.

## Local validation

- 35 existing dashboard web/API tests passed.
- Targeted strict TypeScript check of DashboardWidgetFrame passed.
- Dashboard page bundle/transpilation check and git diff --check passed.
- Playwright fixture used the actual frame component and dashboard stylesheet
  with synthetic cards of varying content length.
- At 1440px: equal three-row cards measured 312px; four-row cards measured 420px.
  Edit-mode frames retained the same heights with no frame overflow. Changing
  spans moved the following row by the expected grid pitch.
- Long desktop lists had a constrained viewport (233px) with larger scrollable
  content (1019px), without changing outer card height.
- At 390px: mobile cards used content-driven heights with no inner list clipping
  and no horizontal page overflow. Desktop/mobile screenshots were inspected.

## Boundary

The browser check validates isolated layout geometry, not a full authenticated
dashboard or live data. Full application typecheck was not rerun in this change;
the preceding widget task records the local full-check timeout. No production
deployment, commit, or push was performed.
