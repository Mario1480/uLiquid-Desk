import type { AppIconName } from "../../components/AppIcon";

export type AdminNavItem = {
  href: string;
  label: string;
  shortLabel?: string;
  icon: AppIconName;
  activeExact?: string[];
  activePrefixes?: string[];
};

export const ADMIN_NAV_ITEMS: AdminNavItem[] = [
  { href: "/admin", label: "Overview", icon: "dashboard" },
  { href: "/admin/users", label: "Users", icon: "users" },
  { href: "/admin/workspaces", label: "Workspaces", icon: "server" },
  { href: "/admin/licenses", label: "Licenses", icon: "subscription" },
  { href: "/admin/alerts", label: "Alerts", icon: "alerts" },
  { href: "/admin/bots", label: "Bots", icon: "bots" },
  { href: "/admin/runners", label: "Runners", icon: "server" },
  { href: "/admin/audit", label: "Audit", icon: "audit" },
  { href: "/admin/statistics", label: "Statistics", icon: "performance" },
  { href: "/admin/providers", label: "Providers", icon: "server" },
  { href: "/admin/affiliate", label: "Affiliate", icon: "link" },
  ...(process.env.NEXT_PUBLIC_ULIQ_ENABLED === "true"
    ? [{ href: "/admin/uliq", label: "ULIQ Testnet", icon: "money" as const }]
    : []),
  {
    href: "/admin/system/vaults/execution",
    label: "Vaults",
    icon: "vaults",
    activePrefixes: [
      "/admin/system/vaults",
      "/admin/vault-execution",
      "/admin/vault-operations",
      "/admin/vault-safety",
      "/admin/grid-hyperliquid-pilot"
    ]
  },
  {
    href: "/admin/system",
    label: "System",
    icon: "settings",
    activeExact: ["/admin/system"],
    activePrefixes: [
      "/admin/system/access",
      "/admin/system/notifications",
      "/admin/system/integrations",
      "/admin/system/ai",
      "/admin/system/bots"
    ]
  }
];
