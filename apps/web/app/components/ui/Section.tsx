import type { ReactNode } from "react";

type SectionTone = "neutral" | "info" | "success" | "warning" | "danger" | "accent";
type SectionDensity = "default" | "compact";

type SectionProps = {
  title?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  tone?: SectionTone;
  density?: SectionDensity;
  children?: ReactNode;
  className?: string;
};

function cx(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(" ");
}

export default function Section({
  title,
  description,
  actions,
  tone = "neutral",
  density = "default",
  children,
  className
}: SectionProps) {
  return (
    <section className={cx("card uiSection", `uiSection-${tone}`, `uiSection-${density}`, className)}>
      {title || description || actions ? (
        <div className="uiSectionHeader">
          <div className="uiSectionHeaderCopy">
            {title ? <h2 className="uiSectionTitle">{title}</h2> : null}
            {description ? <div className="uiSectionDescription">{description}</div> : null}
          </div>
          {actions ? <div className="uiSectionActions">{actions}</div> : null}
        </div>
      ) : null}
      {children !== undefined && children !== null ? <div className="uiSectionBody">{children}</div> : null}
    </section>
  );
}
