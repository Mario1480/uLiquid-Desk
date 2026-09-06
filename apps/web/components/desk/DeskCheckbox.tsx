"use client";
import { forwardRef, type ComponentPropsWithoutRef } from "react";
import { GlassCheckbox } from "../einui/liquid-glass/glass-checkbox";
type Props = Omit<ComponentPropsWithoutRef<typeof GlassCheckbox>, "onCheckedChange"> & { readOnly?: boolean; onCheckedChange?: (checked: boolean) => void };
export const DeskCheckbox = forwardRef<HTMLButtonElement, Props>(function DeskCheckbox({ readOnly, onCheckedChange, ...props }, ref) {
  return <GlassCheckbox {...props} ref={ref} aria-readonly={readOnly || undefined} onCheckedChange={checked => { if (!readOnly) onCheckedChange?.(checked === true); }} />;
});
