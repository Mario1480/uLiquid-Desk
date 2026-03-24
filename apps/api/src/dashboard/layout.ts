import { z } from "zod";

export const DASHBOARD_LAYOUT_KEY_PREFIX = "dashboard_layout:";
export const DASHBOARD_LAYOUT_VERSION = 1;
export const DASHBOARD_LAYOUT_COLUMNS = 12;
export const DASHBOARD_LAYOUT_GAP = 12;
export const DASHBOARD_LAYOUT_ROW_HEIGHT = 96;

export const DASHBOARD_WIDGET_IDS = [
  "alerts",
  "performance",
  "calendar",
  "news",
  "fearGreed",
  "accounts",
  "wallet",
  "openPositions"
] as const;

export type DashboardWidgetId = (typeof DASHBOARD_WIDGET_IDS)[number];

export type DashboardLayoutItem = {
  id: DashboardWidgetId;
  visible: boolean;
  x: number;
  y: number;
  w: number;
  h: number;
};

export type DashboardLayoutResponse = {
  version: 1;
  desktop: {
    columns: 12;
    gap: 12;
    rowHeight: 96;
  };
  items: DashboardLayoutItem[];
};

const dashboardWidgetIdSchema = z.enum(DASHBOARD_WIDGET_IDS);

const dashboardLayoutItemSchema = z.object({
  id: dashboardWidgetIdSchema,
  visible: z.boolean().default(true),
  x: z.coerce.number().int().min(0).default(0),
  y: z.coerce.number().int().min(0).default(0),
  w: z.coerce.number().int().min(1).max(DASHBOARD_LAYOUT_COLUMNS).default(DASHBOARD_LAYOUT_COLUMNS),
  h: z.coerce.number().int().min(1).max(12).default(2)
}).superRefine((value, ctx) => {
  if (value.x + value.w > DASHBOARD_LAYOUT_COLUMNS) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "x_plus_w_exceeds_columns",
      path: ["x"]
    });
  }
});

export const dashboardLayoutUpdateSchema = z.object({
  version: z.literal(DASHBOARD_LAYOUT_VERSION).default(DASHBOARD_LAYOUT_VERSION),
  desktop: z.object({
    columns: z.literal(DASHBOARD_LAYOUT_COLUMNS).default(DASHBOARD_LAYOUT_COLUMNS),
    gap: z.literal(DASHBOARD_LAYOUT_GAP).default(DASHBOARD_LAYOUT_GAP),
    rowHeight: z.literal(DASHBOARD_LAYOUT_ROW_HEIGHT).default(DASHBOARD_LAYOUT_ROW_HEIGHT)
  }).default({
    columns: DASHBOARD_LAYOUT_COLUMNS,
    gap: DASHBOARD_LAYOUT_GAP,
    rowHeight: DASHBOARD_LAYOUT_ROW_HEIGHT
  }),
  items: z.array(dashboardLayoutItemSchema).max(DASHBOARD_WIDGET_IDS.length).default([])
}).superRefine((value, ctx) => {
  const seen = new Set<string>();
  for (const item of value.items) {
    if (seen.has(item.id)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "duplicate_widget_id",
        path: ["items"]
      });
      return;
    }
    seen.add(item.id);
  }
});

const LEGACY_DEFAULT_DASHBOARD_LAYOUT: DashboardLayoutResponse = {
  version: DASHBOARD_LAYOUT_VERSION,
  desktop: {
    columns: DASHBOARD_LAYOUT_COLUMNS,
    gap: DASHBOARD_LAYOUT_GAP,
    rowHeight: DASHBOARD_LAYOUT_ROW_HEIGHT
  },
  items: [
    { id: "alerts", visible: true, x: 0, y: 0, w: 12, h: 2 },
    { id: "performance", visible: true, x: 0, y: 2, w: 8, h: 6 },
    { id: "calendar", visible: true, x: 8, y: 2, w: 4, h: 3 },
    { id: "news", visible: true, x: 8, y: 5, w: 4, h: 3 },
    { id: "fearGreed", visible: true, x: 8, y: 8, w: 4, h: 3 },
    { id: "accounts", visible: true, x: 0, y: 11, w: 12, h: 4 },
    { id: "wallet", visible: true, x: 0, y: 15, w: 4, h: 3 },
    { id: "openPositions", visible: true, x: 0, y: 18, w: 12, h: 5 }
  ]
};

export const DEFAULT_DASHBOARD_LAYOUT: DashboardLayoutResponse = {
  version: DASHBOARD_LAYOUT_VERSION,
  desktop: {
    columns: DASHBOARD_LAYOUT_COLUMNS,
    gap: DASHBOARD_LAYOUT_GAP,
    rowHeight: DASHBOARD_LAYOUT_ROW_HEIGHT
  },
  items: [
    { id: "alerts", visible: true, x: 0, y: 0, w: 12, h: 2 },
    { id: "performance", visible: true, x: 0, y: 2, w: 8, h: 6 },
    { id: "calendar", visible: true, x: 8, y: 2, w: 4, h: 3 },
    { id: "news", visible: true, x: 8, y: 5, w: 4, h: 3 },
    { id: "fearGreed", visible: true, x: 8, y: 8, w: 4, h: 3 },
    { id: "accounts", visible: true, x: 0, y: 11, w: 12, h: 4 },
    { id: "wallet", visible: true, x: 0, y: 15, w: 4, h: 3 },
    { id: "openPositions", visible: true, x: 4, y: 15, w: 8, h: 3 }
  ]
};

export function dashboardLayoutKey(userId: string): string {
  return `${DASHBOARD_LAYOUT_KEY_PREFIX}${userId}`;
}

function cloneDefaultItem(id: DashboardWidgetId): DashboardLayoutItem {
  const item = DEFAULT_DASHBOARD_LAYOUT.items.find((entry) => entry.id === id);
  if (!item) {
    throw new Error(`dashboard_default_widget_missing:${id}`);
  }
  return { ...item };
}

export function sortDashboardLayoutItems(items: DashboardLayoutItem[]): DashboardLayoutItem[] {
  const orderIndex = new Map<DashboardWidgetId, number>(
    DASHBOARD_WIDGET_IDS.map((id, index) => [id, index] as const)
  );
  return [...items].sort((left, right) => {
    if (left.visible !== right.visible) return left.visible ? -1 : 1;
    if (left.y !== right.y) return left.y - right.y;
    if (left.x !== right.x) return left.x - right.x;
    return (orderIndex.get(left.id) ?? 0) - (orderIndex.get(right.id) ?? 0);
  });
}

function layoutItemsEqual(left: DashboardLayoutItem[], right: DashboardLayoutItem[]): boolean {
  if (left.length !== right.length) return false;
  return left.every((item, index) => {
    const candidate = right[index];
    return candidate
      && item.id === candidate.id
      && item.visible === candidate.visible
      && item.x === candidate.x
      && item.y === candidate.y
      && item.w === candidate.w
      && item.h === candidate.h;
  });
}

export function normalizeDashboardLayoutValue(value: unknown): DashboardLayoutResponse {
  const raw = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  const rawItems = Array.isArray(raw.items) ? raw.items : [];
  const parsedItems: DashboardLayoutItem[] = [];
  const seen = new Set<DashboardWidgetId>();

  for (const candidate of rawItems) {
    const parsed = dashboardLayoutItemSchema.safeParse(candidate);
    if (!parsed.success) continue;
    if (seen.has(parsed.data.id)) continue;
    seen.add(parsed.data.id);
    parsedItems.push(parsed.data);
  }

  const merged = DASHBOARD_WIDGET_IDS.map((id) => {
    const existing = parsedItems.find((item) => item.id === id);
    return existing ? { ...existing } : cloneDefaultItem(id);
  });
  const nextItems = sortDashboardLayoutItems(merged);

  return {
    version: DASHBOARD_LAYOUT_VERSION,
    desktop: {
      columns: DASHBOARD_LAYOUT_COLUMNS,
      gap: DASHBOARD_LAYOUT_GAP,
      rowHeight: DASHBOARD_LAYOUT_ROW_HEIGHT
    },
    items: layoutItemsEqual(nextItems, sortDashboardLayoutItems(LEGACY_DEFAULT_DASHBOARD_LAYOUT.items))
      ? DEFAULT_DASHBOARD_LAYOUT.items.map((item) => ({ ...item }))
      : nextItems
  };
}
