export const POSITION_COPILOT_MANUAL_REVIEW_HREF = "#trade-positions" as const;

export const POSITION_COPILOT_ALLOWED_CLIENT_REQUESTS = [
  "GET /api/position-copilot/settings",
  "PUT /api/position-copilot/settings",
  "POST /api/position-copilot/analyze"
] as const;

export function isReadOnlyPositionCopilotNavigation(href: string): boolean {
  return href === POSITION_COPILOT_MANUAL_REVIEW_HREF;
}
