import type { ReactElement } from "react";
import { GlassCard } from "../einui/liquid-glass/glass-card";
/** Slot preserves the original element, child hierarchy, layout and business attributes. */
export function DeskSurface({children, dense = false}: {children: ReactElement; dense?: boolean}) {
  return <GlassCard asChild glowEffect={false} data-ein-density={dense ? "dense" : "default"}>{children}</GlassCard>;
}
