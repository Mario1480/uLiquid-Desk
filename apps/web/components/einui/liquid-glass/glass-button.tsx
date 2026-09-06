"use client";
import * as React from "react";
import { Slot } from "radix-ui";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../utils";
const glassButtonVariants = cva("ein-button", {
  variants: {
    variant: { default: "ein-button-default", primary: "ein-button-primary", outline: "ein-button-outline", ghost: "ein-button-ghost", destructive: "ein-button-destructive" },
    size: { default: "ein-button-md", sm: "ein-button-sm", lg: "ein-button-lg", icon: "ein-button-icon" }
  }, defaultVariants: { variant: "default", size: "default" }
});
export interface GlassButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof glassButtonVariants> {
  asChild?: boolean;
  /** Retained for source compatibility; Desk buttons deliberately have no glow. */
  glowEffect?: boolean;
  /** Keep existing Desk layout and semantic classes without adding wrappers. */
  nativeLayout?: boolean;
}
const GlassButton = React.forwardRef<HTMLButtonElement, GlassButtonProps>(function GlassButton({asChild, glowEffect: _glow, nativeLayout, variant, size, className, ...props}, ref) {
  const Component = asChild ? Slot.Root : "button";
  return <Component ref={ref} data-ein-button="true" className={cn(nativeLayout ? "ein-native-button" : glassButtonVariants({variant,size}),className)} {...props} />;
});
export { GlassButton, glassButtonVariants };
