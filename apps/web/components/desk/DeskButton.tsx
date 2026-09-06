"use client";
import { forwardRef, type ComponentPropsWithoutRef } from "react";
import { GlassButton } from "../einui/liquid-glass/glass-button";
/** Native event, ref and attribute contract retained during the visual migration. */
export const DeskButton = forwardRef<HTMLButtonElement, ComponentPropsWithoutRef<"button">>(function DeskButton(props, ref) {
  return <GlassButton nativeLayout {...props} ref={ref} />;
});
