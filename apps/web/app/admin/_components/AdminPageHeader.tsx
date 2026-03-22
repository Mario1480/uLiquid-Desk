import Link from "next/link";

type AdminPageHeaderProps = {
  eyebrow?: string;
  title: string;
  description?: string;
  actions?: Array<{ href: string; label: string }>;
};

export default function AdminPageHeader({ eyebrow, title, description, actions = [] }: AdminPageHeaderProps) {
  return (
    <div className="settingsSection adminPageHeader">
      <div className="adminPageHeaderBody">
        {eyebrow ? <div className="adminPageEyebrow">{eyebrow}</div> : null}
        <h1 className="adminPageTitle">{title}</h1>
        {description ? <p className="adminPageDescription">{description}</p> : null}
      </div>
      {actions.length > 0 ? (
        <div className="adminPageActions">
          {actions.map((action, index) => (
            <Link key={action.href} href={action.href} className={`btn ${index === 0 ? "btnPrimary" : ""}`.trim()}>
              {action.label}
            </Link>
          ))}
        </div>
      ) : null}
    </div>
  );
}
