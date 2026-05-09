import Link from "next/link";
import PageHeader from "../../components/ui/PageHeader";

type AdminPageHeaderProps = {
  eyebrow?: string;
  title: string;
  description?: string;
  actions?: Array<{ href: string; label: string }>;
};

export default function AdminPageHeader({ eyebrow, title, description, actions = [] }: AdminPageHeaderProps) {
  const actionNodes = actions.length > 0 ? (
    <>
      {actions.map((action, index) => (
        <Link key={action.href} href={action.href} className={`btn ${index === 0 ? "btnPrimary" : ""}`.trim()}>
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
