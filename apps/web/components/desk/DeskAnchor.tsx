"use client";
import { forwardRef, type ComponentPropsWithoutRef } from "react";
import { GlassButton } from "../einui/liquid-glass/glass-button";
/** External/download actions retain native anchor target, rel, href and download behavior. */
export const DeskAnchor = forwardRef<HTMLAnchorElement, ComponentPropsWithoutRef<"a">>(function DeskAnchor(props, ref) {
  return <GlassButton asChild nativeLayout><a {...props} ref={ref} /></GlassButton>;
});
