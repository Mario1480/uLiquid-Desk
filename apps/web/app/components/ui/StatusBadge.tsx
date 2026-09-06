import { GlassBadge } from "@/components/einui/liquid-glass/glass-badge";
import type { ReactNode } from "react";

type StatusBadgeTone = "neutral" | "info" | "success" | "warning" | "danger" | "accent";

type StatusBadgeProps = {
  tone?: StatusBadgeTone;
  children: ReactNode;
  className?: string;
  title?: string;
};

function cx(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(" ");
}

export default function StatusBadge({
  tone = "neutral",
  children,
  className,
  title
}: StatusBadgeProps) {
  return (
    <GlassBadge nativeLayout className={cx("badge uiStatusBadge", `uiStatusBadge-${tone}`, className)} title={title}>
      {children}
    </GlassBadge>
  );
}
