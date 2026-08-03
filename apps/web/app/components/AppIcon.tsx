"use client";

import React from "react";

import {
  Archive,
  ArrowDownToLine,
  ArrowLeft,
  ArrowUpFromLine,
  BadgeDollarSign,
  Ban,
  BrainCircuit,
  CalendarDays,
  ChartLine,
  ChartNoAxesCombined,
  ChevronDown,
  ChevronRight,
  Check,
  Circle,
  CircleHelp,
  Coins,
  Copy,
  Cpu,
  CreditCard,
  Download,
  ExternalLink,
  Eye,
  FilePlus,
  FileText,
  Filter,
  Gauge,
  Globe,
  Grid3X3,
  GripVertical,
  KeyRound,
  Landmark,
  Link as LinkIcon,
  List,
  ListChecks,
  LogIn,
  LogOut,
  Mail,
  Maximize2,
  Menu,
  Minus,
  Newspaper,
  Pause,
  Pencil,
  Play,
  Plus,
  ReceiptText,
  RefreshCw,
  Repeat2,
  Rocket,
  RotateCcw,
  Save,
  Search,
  Send,
  Server,
  Settings,
  ShieldCheck,
  ShieldPlus,
  SlidersHorizontal,
  Smartphone,
  Sparkles,
  Square,
  Star,
  Trash2,
  TriangleAlert,
  Unlink,
  Upload,
  UserPlus,
  Users,
  Wallet,
  WalletCards,
  Wrench,
  X,
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
  | "chevronDown"
  | "chevronRight"
  | "create"
  | "add"
  | "remove"
  | "save"
  | "refresh"
  | "reload"
  | "reset"
  | "restore"
  | "delete"
  | "trash"
  | "close"
  | "cancel"
  | "menu"
  | "back"
  | "open"
  | "external"
  | "copy"
  | "edit"
  | "send"
  | "link"
  | "unlink"
  | "start"
  | "play"
  | "launch"
  | "pause"
  | "stop"
  | "archive"
  | "disable"
  | "deposit"
  | "withdraw"
  | "transfer"
  | "switch"
  | "manage"
  | "drag"
  | "resize"
  | "max"
  | "check"
  | "confirm"
  | "preview"
  | "search"
  | "filter"
  | "list"
  | "favorite"
  | "mail"
  | "login"
  | "register"
  | "key"
  | "shield"
  | "download"
  | "upload"
  | "money"
  | "balance"
  | "mobile"
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
  chevronDown: ChevronDown,
  chevronRight: ChevronRight,
  create: Plus,
  add: Plus,
  remove: Minus,
  save: Save,
  refresh: RefreshCw,
  reload: RefreshCw,
  reset: RotateCcw,
  restore: RotateCcw,
  delete: Trash2,
  trash: Trash2,
  close: X,
  cancel: X,
  menu: Menu,
  back: ArrowLeft,
  open: ExternalLink,
  external: ExternalLink,
  copy: Copy,
  edit: Pencil,
  send: Send,
  link: LinkIcon,
  unlink: Unlink,
  start: Play,
  play: Play,
  launch: Rocket,
  pause: Pause,
  stop: Square,
  archive: Archive,
  disable: Ban,
  deposit: ArrowDownToLine,
  withdraw: ArrowUpFromLine,
  transfer: Repeat2,
  switch: Repeat2,
  manage: Wrench,
  drag: GripVertical,
  resize: Maximize2,
  max: Maximize2,
  check: Check,
  confirm: Check,
  preview: Eye,
  search: Search,
  filter: Filter,
  list: List,
  favorite: Star,
  mail: Mail,
  login: LogIn,
  register: UserPlus,
  key: KeyRound,
  shield: ShieldCheck,
  download: Download,
  upload: Upload,
  money: BadgeDollarSign,
  balance: Coins,
  mobile: Smartphone,
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
