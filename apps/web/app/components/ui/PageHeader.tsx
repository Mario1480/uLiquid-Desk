import type { ReactNode } from "react";

type PageHeaderTone = "neutral" | "info" | "success" | "warning" | "danger" | "accent";

type PageHeaderProps = {
  eyebrow?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  tone?: PageHeaderTone;
  className?: string;
};

function cx(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(" ");
}

export default function PageHeader({
  eyebrow,
  title,
  description,
  actions,
  tone = "neutral",
  className
}: PageHeaderProps) {
  return (
    <header className={cx("uiPageHeader", `uiPageHeader-${tone}`, className)}>
      <div className="uiPageHeaderBody">
        {eyebrow ? <div className="uiPageEyebrow">{eyebrow}</div> : null}
        <h1 className="uiPageTitle">{title}</h1>
        {description ? <p className="uiPageDescription">{description}</p> : null}
      </div>
      {actions ? <div className="uiPageActions">{actions}</div> : null}
    </header>
  );
}
