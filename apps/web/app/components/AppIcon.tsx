"use client";

import {
  BrainCircuit,
  CalendarDays,
  ChartLine,
  ChartNoAxesCombined,
  ChevronRight,
  Circle,
  CircleHelp,
  Cpu,
  CreditCard,
  FilePlus,
  FileText,
  Gauge,
  Globe,
  Grid3X3,
  Landmark,
  ListChecks,
  LogOut,
  Newspaper,
  Plus,
  ReceiptText,
  Send,
  Server,
  Settings,
  ShieldCheck,
  ShieldPlus,
  SlidersHorizontal,
  Sparkles,
  TriangleAlert,
  Users,
  Wallet,
  WalletCards,
  type LucideIcon,
  type LucideProps
} from "lucide-react";

export type AppIconName =
  | "dashboard"
  | "trading"
  | "manualTrading"
  | "trade"
  | "accounts"
  | "bots"
  | "predictions"
  | "positions"
  | "gridBots"
  | "grid"
  | "performance"
  | "news"
  | "calendar"
  | "settings"
  | "alerts"
  | "risk"
  | "riskAlerts"
  | "logout"
  | "wallet"
  | "funding"
  | "vaults"
  | "vault"
  | "admin"
  | "help"
  | "detail"
  | "plus"
  | "users"
  | "audit"
  | "billing"
  | "subscription"
  | "server"
  | "telegram"
  | "ai"
  | "strategies"
  | "exchange"
  | "template"
  | "chevronRight"
  | "generic";

const APP_ICON_MAP: Record<AppIconName, LucideIcon> = {
  dashboard: Gauge,
  trading: SlidersHorizontal,
  manualTrading: SlidersHorizontal,
  trade: SlidersHorizontal,
  accounts: WalletCards,
  bots: Cpu,
  predictions: Sparkles,
  positions: ChartNoAxesCombined,
  gridBots: Grid3X3,
  grid: Grid3X3,
  performance: ChartLine,
  news: Newspaper,
  calendar: CalendarDays,
  settings: Settings,
  alerts: TriangleAlert,
  risk: TriangleAlert,
  riskAlerts: TriangleAlert,
  logout: LogOut,
  wallet: Wallet,
  funding: Landmark,
  vaults: ShieldCheck,
  vault: ShieldCheck,
  admin: ShieldPlus,
  help: CircleHelp,
  detail: FileText,
  plus: Plus,
  users: Users,
  audit: ListChecks,
  billing: ReceiptText,
  subscription: CreditCard,
  server: Server,
  telegram: Send,
  ai: BrainCircuit,
  strategies: BrainCircuit,
  exchange: Globe,
  template: FilePlus,
  chevronRight: ChevronRight,
  generic: Circle
};

export type AppIconProps = Omit<LucideProps, "ref"> & {
  name: AppIconName;
  title?: string;
};

export function AppIcon({
  name,
  size = "1em",
  strokeWidth = 1.8,
  color = "currentColor",
  title,
  "aria-hidden": ariaHidden = true,
  ...iconProps
}: AppIconProps) {
  const Icon = APP_ICON_MAP[name];
  const isHidden = ariaHidden !== false && ariaHidden !== "false";

  return (
    <Icon
      {...iconProps}
      aria-hidden={isHidden}
      aria-label={isHidden ? undefined : title}
      color={color}
      focusable={false}
      role={isHidden ? undefined : "img"}
      size={size}
      strokeWidth={strokeWidth}
    />
  );
}
