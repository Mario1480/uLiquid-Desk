"use client";
import { forwardRef, type ComponentPropsWithoutRef } from "react";
import { GlassSwitch } from "../einui/liquid-glass/glass-switch";
type Props = ComponentPropsWithoutRef<typeof GlassSwitch> & { readOnly?: boolean };
export const DeskSwitch = forwardRef<HTMLButtonElement, Props>(function DeskSwitch({ readOnly, onCheckedChange, ...props }, ref) {
  return <GlassSwitch {...props} ref={ref} aria-readonly={readOnly || undefined} onCheckedChange={checked => { if (!readOnly) onCheckedChange?.(checked); }} />;
});
