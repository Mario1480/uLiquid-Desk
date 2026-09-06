"use client";
import { forwardRef, type ComponentPropsWithoutRef } from "react";
import { GlassTable } from "../einui/liquid-glass/glass-table";
/** Native event, ref and attribute contract retained during the visual migration. */
export const DeskTable = forwardRef<HTMLTableElement, ComponentPropsWithoutRef<"table">>(function DeskTable(props, ref) {
  return <GlassTable nativeLayout {...props} ref={ref} />;
});
