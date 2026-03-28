export const DASHBOARD_LAYOUT_VERSION = 1 as const;
export const DASHBOARD_LAYOUT_COLUMNS = 12 as const;
export const DASHBOARD_LAYOUT_GAP = 12 as const;
export const DASHBOARD_LAYOUT_ROW_HEIGHT = 96 as const;

export const DASHBOARD_WIDGET_IDS = [
  "alerts",
  "performance",
  "calendar",
  "news",
  "fearGreed",
  "accounts",
  "botsOverview",
  "gridBotsOverview",
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
  version: typeof DASHBOARD_LAYOUT_VERSION;
  desktop: {
    columns: typeof DASHBOARD_LAYOUT_COLUMNS;
    gap: typeof DASHBOARD_LAYOUT_GAP;
    rowHeight: typeof DASHBOARD_LAYOUT_ROW_HEIGHT;
  };
  items: DashboardLayoutItem[];
  updatedAt?: string | null;
};

export type DashboardWidgetIconKey =
  | "overview"
  | "riskAlerts"
  | "calendar"
  | "news"
  | "marketContext"
  | "accounts"
  | "wallet"
  | "manualTrading"
  | "bots";

export type DashboardWidgetRegistryEntry = {
  id: DashboardWidgetId;
  titleKey: string;
  anchorId: string;
  icon: DashboardWidgetIconKey;
  defaultSize: Pick<DashboardLayoutItem, "w" | "h">;
};

export const DASHBOARD_WIDGET_REGISTRY: DashboardWidgetRegistryEntry[] = [
  {
    id: "alerts",
    titleKey: "alerts.title",
    anchorId: "widget-alerts",
    icon: "riskAlerts",
    defaultSize: { w: 12, h: 2 }
  },
  {
    id: "performance",
    titleKey: "performance.title",
    anchorId: "widget-performance",
    icon: "overview",
    defaultSize: { w: 8, h: 6 }
  },
  {
    id: "calendar",
    titleKey: "calendar.title",
    anchorId: "widget-calendar",
    icon: "calendar",
    defaultSize: { w: 4, h: 3 }
  },
  {
    id: "news",
    titleKey: "news.title",
    anchorId: "widget-news",
    icon: "news",
    defaultSize: { w: 4, h: 3 }
  },
  {
    id: "fearGreed",
    titleKey: "fearGreed.title",
    anchorId: "widget-fear-greed",
    icon: "marketContext",
    defaultSize: { w: 4, h: 3 }
  },
  {
    id: "accounts",
    titleKey: "stats.exchangeAccounts",
    anchorId: "widget-accounts",
    icon: "accounts",
    defaultSize: { w: 12, h: 4 }
  },
  {
    id: "botsOverview",
    titleKey: "botsOverview.title",
    anchorId: "widget-bots-overview",
    icon: "bots",
    defaultSize: { w: 4, h: 3 }
  },
  {
    id: "gridBotsOverview",
    titleKey: "gridBotsOverview.title",
    anchorId: "widget-grid-bots-overview",
    icon: "bots",
    defaultSize: { w: 4, h: 3 }
  },
  {
    id: "wallet",
    titleKey: "walletCard.title",
    anchorId: "widget-wallet",
    icon: "wallet",
    defaultSize: { w: 4, h: 3 }
  },
  {
    id: "openPositions",
    titleKey: "openPositions.title",
    anchorId: "widget-open-positions",
    icon: "manualTrading",
    defaultSize: { w: 8, h: 3 }
  }
];

const LEGACY_DEFAULT_LAYOUT_ITEMS: DashboardLayoutItem[] = [
  { id: "alerts", visible: true, x: 0, y: 0, w: 12, h: 2 },
  { id: "performance", visible: true, x: 0, y: 2, w: 8, h: 6 },
  { id: "calendar", visible: true, x: 8, y: 2, w: 4, h: 3 },
  { id: "news", visible: true, x: 8, y: 5, w: 4, h: 3 },
  { id: "fearGreed", visible: true, x: 8, y: 8, w: 4, h: 3 },
  { id: "accounts", visible: true, x: 0, y: 11, w: 12, h: 4 },
  { id: "wallet", visible: true, x: 0, y: 15, w: 4, h: 3 },
  { id: "botsOverview", visible: true, x: 4, y: 15, w: 4, h: 3 },
  { id: "gridBotsOverview", visible: true, x: 8, y: 15, w: 4, h: 3 },
  { id: "openPositions", visible: true, x: 0, y: 18, w: 12, h: 5 }
];

const DEFAULT_LAYOUT_ITEMS: DashboardLayoutItem[] = [
  { id: "alerts", visible: true, x: 0, y: 0, w: 12, h: 2 },
  { id: "performance", visible: true, x: 0, y: 2, w: 8, h: 6 },
  { id: "calendar", visible: true, x: 8, y: 2, w: 4, h: 3 },
  { id: "news", visible: true, x: 8, y: 5, w: 4, h: 3 },
  { id: "fearGreed", visible: true, x: 8, y: 8, w: 4, h: 3 },
  { id: "accounts", visible: true, x: 0, y: 11, w: 12, h: 4 },
  { id: "wallet", visible: true, x: 0, y: 15, w: 4, h: 3 },
  { id: "botsOverview", visible: true, x: 4, y: 15, w: 4, h: 3 },
  { id: "gridBotsOverview", visible: true, x: 8, y: 15, w: 4, h: 3 },
  { id: "openPositions", visible: true, x: 0, y: 18, w: 12, h: 3 }
];

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

function defaultItem(id: DashboardWidgetId): DashboardLayoutItem {
  const item = DEFAULT_LAYOUT_ITEMS.find((entry) => entry.id === id);
  if (!item) {
    throw new Error(`dashboard_widget_default_missing:${id}`);
  }
  return { ...item };
}

export function getDefaultDashboardLayout(): DashboardLayoutResponse {
  return {
    version: DASHBOARD_LAYOUT_VERSION,
    desktop: {
      columns: DASHBOARD_LAYOUT_COLUMNS,
      gap: DASHBOARD_LAYOUT_GAP,
      rowHeight: DASHBOARD_LAYOUT_ROW_HEIGHT
    },
    items: DEFAULT_LAYOUT_ITEMS.map((item) => ({ ...item })),
    updatedAt: null
  };
}

export function clampDashboardWidth(value: number): number {
  return Math.min(DASHBOARD_LAYOUT_COLUMNS, Math.max(1, Math.round(value)));
}

export function clampDashboardHeight(value: number): number {
  return Math.min(12, Math.max(1, Math.round(value)));
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

export function normalizeDashboardLayout(value: Partial<DashboardLayoutResponse> | DashboardLayoutResponse | null | undefined): DashboardLayoutResponse {
  const base = getDefaultDashboardLayout();
  const rawItems = Array.isArray(value?.items) ? value.items : [];
  const parsedItems: DashboardLayoutItem[] = [];
  const seen = new Set<DashboardWidgetId>();

  for (const candidate of rawItems) {
    if (!candidate || typeof candidate !== "object") continue;
    const id = String(candidate.id ?? "") as DashboardWidgetId;
    if (!DASHBOARD_WIDGET_IDS.includes(id)) continue;
    if (seen.has(id)) continue;
    seen.add(id);
    const x = Math.max(0, Math.floor(Number(candidate.x ?? 0) || 0));
    const y = Math.max(0, Math.floor(Number(candidate.y ?? 0) || 0));
    const w = clampDashboardWidth(Number(candidate.w ?? defaultItem(id).w));
    const h = clampDashboardHeight(Number(candidate.h ?? defaultItem(id).h));
    const visible = candidate.visible !== false;
    parsedItems.push({
      id,
      visible,
      x: x + w > DASHBOARD_LAYOUT_COLUMNS ? Math.max(0, DASHBOARD_LAYOUT_COLUMNS - w) : x,
      y,
      w,
      h
    });
  }

  const merged = DASHBOARD_WIDGET_IDS.map((id) => parsedItems.find((item) => item.id === id) ?? defaultItem(id));
  const nextItems = sortDashboardLayoutItems(merged);

  return {
    version: DASHBOARD_LAYOUT_VERSION,
    desktop: base.desktop,
    items: layoutItemsEqual(nextItems, sortDashboardLayoutItems(LEGACY_DEFAULT_LAYOUT_ITEMS))
      ? DEFAULT_LAYOUT_ITEMS.map((item) => ({ ...item }))
      : nextItems,
    updatedAt: value?.updatedAt ?? null
  };
}

export function repackDashboardLayoutItems(items: DashboardLayoutItem[]): DashboardLayoutItem[] {
  const visible = items
    .filter((item) => item.visible)
    .map((item) => ({
      ...item,
      w: clampDashboardWidth(item.w),
      h: clampDashboardHeight(item.h)
    }));
  const hidden = items
    .filter((item) => !item.visible)
    .map((item) => ({
      ...item,
      w: clampDashboardWidth(item.w),
      h: clampDashboardHeight(item.h)
    }));

  let cursorX = 0;
  let cursorY = 0;
  let rowHeight = 0;

  const packedVisible = visible.map((item) => {
    if (cursorX + item.w > DASHBOARD_LAYOUT_COLUMNS) {
      cursorX = 0;
      cursorY += rowHeight;
      rowHeight = 0;
    }

    const nextItem = {
      ...item,
      x: cursorX,
      y: cursorY
    };

    cursorX += item.w;
    rowHeight = Math.max(rowHeight, item.h);
    return nextItem;
  });

  return [...packedVisible, ...hidden];
}

export function updateDashboardLayoutItems(
  items: DashboardLayoutItem[],
  updater: (current: DashboardLayoutItem[]) => DashboardLayoutItem[]
): DashboardLayoutItem[] {
  return repackDashboardLayoutItems(updater(items).map((item) => ({ ...item })));
}
