import type { ReactNode } from "react";

type NoticeTone = "neutral" | "info" | "success" | "warning" | "danger" | "accent";

type NoticeProps = {
  tone?: NoticeTone;
  children: ReactNode;
  className?: string;
  role?: "alert" | "status" | "note";
};

function cx(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(" ");
}

export default function Notice({
  tone = "neutral",
  children,
  className,
  role
}: NoticeProps) {
  const resolvedRole = role ?? (tone === "danger" ? "alert" : "status");

  return (
    <div className={cx("uiNotice", `uiNotice-${tone}`, className)} role={resolvedRole}>
      {children}
    </div>
  );
}
