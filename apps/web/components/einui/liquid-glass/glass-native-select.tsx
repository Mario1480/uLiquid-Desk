"use client";
import { forwardRef, type ComponentPropsWithoutRef } from "react";
import { cn } from "../utils";
/** Native-select adapter for existing controlled Desk forms. Radix Select remains available separately. */
export const GlassNativeSelect = forwardRef<HTMLSelectElement, ComponentPropsWithoutRef<"select">>(function GlassNativeSelect({className,...props},ref) {
  return <select ref={ref} data-ein-control="true" className={cn("ein-native-control",className)} {...props} />;
});
