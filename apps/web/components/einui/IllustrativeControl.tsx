"use client";
import type { ReactNode } from "react";
import { glassButtonVariants } from "./liquid-glass/glass-button";
export function IllustrativeControl({ children, variant = "default", className = "" }: { children: ReactNode; variant?: "primary" | "default"; className?: string }) {
  return <span className={glassButtonVariants({ variant, size: "sm", className: `illustrative-control ${className}` })}>{children}</span>;
}
