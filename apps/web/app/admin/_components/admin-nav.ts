export type AdminNavItem = {
  href: string;
  label: string;
  shortLabel?: string;
};

export const ADMIN_NAV_ITEMS: AdminNavItem[] = [
  { href: "/admin", label: "Overview" },
  { href: "/admin/users", label: "Users" },
  { href: "/admin/workspaces", label: "Workspaces" },
  { href: "/admin/licenses", label: "Licenses" },
  { href: "/admin/alerts", label: "Alerts" },
  { href: "/admin/bots", label: "Bots" },
  { href: "/admin/runners", label: "Runners" },
  { href: "/admin/audit", label: "Audit" },
  { href: "/admin/statistics", label: "Statistics" },
  { href: "/admin/system", label: "System" },
  { href: "/admin/legacy", label: "Legacy Tools", shortLabel: "Legacy" }
];
