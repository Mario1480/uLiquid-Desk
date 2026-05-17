import type { AppIconName } from "../../components/AppIcon";

export type AdminSectionNavItem = {
  href: string;
  label: string;
  icon?: AppIconName;
};

export const SYSTEM_SECTION_NAV: AdminSectionNavItem[] = [
  { href: "/admin/system", label: "Overview", icon: "dashboard" },
  { href: "/admin/system/access", label: "Access", icon: "shield" },
  { href: "/admin/system/notifications/smtp", label: "Notifications", icon: "mail" },
  { href: "/admin/system/integrations/api-keys", label: "Integrations", icon: "key" },
  { href: "/admin/system/ai/prompts", label: "AI Controls", icon: "ai" },
  { href: "/admin/system/vaults/execution", label: "Vault Controls", icon: "vaults" }
];

export const LICENSES_SECTION_NAV: AdminSectionNavItem[] = [
  { href: "/admin/licenses", label: "Inventory", icon: "list" },
  { href: "/admin/licenses/packages", label: "Packages", icon: "billing" }
];
