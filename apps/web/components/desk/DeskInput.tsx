"use client";
import { forwardRef, type ComponentPropsWithoutRef } from "react";
import { GlassInput } from "../einui/liquid-glass/glass-input";
/** Native event, ref and attribute contract retained during the visual migration. */
export const DeskInput = forwardRef<HTMLInputElement, ComponentPropsWithoutRef<"input">>(function DeskInput(props, ref) {
  return <GlassInput nativeLayout {...props} ref={ref} />;
});
