import Link from "next/link";
import { AppIcon, type AppIconName } from "../../components/AppIcon";
import PageHeader from "../../components/ui/PageHeader";

type AdminPageHeaderProps = {
  eyebrow?: string;
  title: string;
  description?: string;
  actions?: Array<{ href: string; label: string }>;
};

function iconForAdminAction(action: { href: string; label: string }, index: number): AppIconName {
  const text = `${action.href} ${action.label}`.toLowerCase();
  if (text.includes("alert")) return "alerts";
  if (text.includes("audit")) return "audit";
  if (text.includes("user")) return "users";
  if (text.includes("workspace")) return "server";
  if (text.includes("grid")) return "grid";
  if (text.includes("vault")) return "vault";
  if (text.includes("back")) return "back";
  return index === 0 ? "open" : "detail";
}

export default function AdminPageHeader({ eyebrow, title, description, actions = [] }: AdminPageHeaderProps) {
  const actionNodes = actions.length > 0 ? (
    <>
      {actions.map((action, index) => (
        <Link key={action.href} href={action.href} className={`btn ${index === 0 ? "btnPrimary" : ""}`.trim()}>
          <AppIcon name={iconForAdminAction(action, index)} />
          {action.label}
        </Link>
      ))}
    </>
  ) : null;

  return (
    <PageHeader
      eyebrow={eyebrow}
      title={title}
      description={description}
      actions={actionNodes}
      tone="accent"
      className="settingsSection adminPageHeader"
    />
  );
}
