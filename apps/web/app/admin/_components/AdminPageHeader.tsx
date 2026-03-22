import Link from "next/link";

type AdminPageHeaderProps = {
  title: string;
  description?: string;
  actions?: Array<{ href: string; label: string }>;
};

export default function AdminPageHeader({ title, description, actions = [] }: AdminPageHeaderProps) {
  return (
    <div className="adminPageHeader">
      <div>
        <h1 className="adminPageTitle">{title}</h1>
        {description ? <p className="adminPageDescription">{description}</p> : null}
      </div>
      {actions.length > 0 ? (
        <div className="adminPageActions">
          {actions.map((action) => (
            <Link key={action.href} href={action.href} className="btn">
              {action.label}
            </Link>
          ))}
        </div>
      ) : null}
    </div>
  );
}
