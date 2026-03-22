export type AdminSectionNavItem = {
  href: string;
  label: string;
};

export const SYSTEM_SECTION_NAV: AdminSectionNavItem[] = [
  { href: "/admin/system", label: "Overview" },
  { href: "/admin/system/access", label: "Access" },
  { href: "/admin/system/notifications/smtp", label: "Notifications" },
  { href: "/admin/system/integrations/api-keys", label: "Integrations" },
  { href: "/admin/system/ai/prompts", label: "AI Controls" },
  { href: "/admin/system/vaults/execution", label: "Vault Controls" }
];

export const LICENSES_SECTION_NAV: AdminSectionNavItem[] = [
  { href: "/admin/licenses", label: "Inventory" },
  { href: "/admin/licenses/packages", label: "Packages" }
];
