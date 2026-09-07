"use client";
import { forwardRef, type ComponentPropsWithoutRef } from "react";
import Link from "next/link";
import { GlassButton } from "../einui/liquid-glass/glass-button";
/** Ein button presentation with Next navigation, URL, prefetch and anchor semantics intact. */
export const DeskLink = forwardRef<HTMLAnchorElement, ComponentPropsWithoutRef<typeof Link>>(function DeskLink(props, ref) {
  return <GlassButton asChild nativeLayout><Link {...props} ref={ref} /></GlassButton>;
});
