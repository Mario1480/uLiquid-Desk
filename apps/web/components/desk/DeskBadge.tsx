"use client";
import { forwardRef, type ComponentPropsWithoutRef } from "react";
import { GlassBadge } from "../einui/liquid-glass/glass-badge";
/** Preserve existing status classes, content and native span attributes. */
export const DeskBadge = forwardRef<HTMLSpanElement, ComponentPropsWithoutRef<"span">>(function DeskBadge({ className, ...props }, ref) {
  const classes = className || "";
  const variant = /danger|error|destructive|badgeShort|ChipShort|StatusCancelled|Pillfailed|Pillexpired/i.test(classes) ? "destructive"
    : /warn|Pillreview_required/i.test(classes) ? "warning"
    : /success|badgeOk|badgeLong|ChipLong|StatusFilled|Pillpaid|newsBadgeCrypto/i.test(classes) ? "success"
    : /accent|info|newsBadgeGeneral|StatusOpen|Pillpending|Pillconfirming/i.test(classes) ? "primary" : "default";
  return <GlassBadge nativeLayout variant={variant} className={className} ref={ref} {...props} />;
});
