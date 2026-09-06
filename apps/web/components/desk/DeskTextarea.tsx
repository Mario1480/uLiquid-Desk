"use client";
import { forwardRef, type ComponentPropsWithoutRef } from "react";
import { GlassTextarea } from "../einui/liquid-glass/glass-textarea";
/** Native event, ref and attribute contract retained during the visual migration. */
export const DeskTextarea = forwardRef<HTMLTextAreaElement, ComponentPropsWithoutRef<"textarea">>(function DeskTextarea(props, ref) {
  return <GlassTextarea nativeLayout {...props} ref={ref} />;
});
