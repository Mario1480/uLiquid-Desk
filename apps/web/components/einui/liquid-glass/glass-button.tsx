"use client";
import * as React from "react";
import { Slot } from "radix-ui";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../utils";
const glassButtonVariants = cva("ein-button", {
  variants: {
    variant: { default: "ein-button-default", primary: "ein-button-primary", outline: "ein-button-outline", ghost: "ein-button-ghost", destructive: "ein-button-destructive", success: "ein-button-success", warning: "ein-button-warning" },
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
  const childClass = asChild && React.isValidElement<{className?: string}>(props.children) ? props.children.props.className ?? "" : "";
  const classes = [className, childClass].filter(Boolean).join(" ");
  const resolved = variant ?? (nativeLayout ? /btnStop|btnDanger/.test(classes) ? "destructive" : /btnStart/.test(classes) ? "success" : /btnPause/.test(classes) ? "warning" : /btnPrimary|\b\w*Active\b|\bisActive\b/.test(classes) ? "primary" : /\bbtn\b/.test(classes) ? "default" : "ghost" : "default");
  return <Component ref={ref} data-ein-button-variant={resolved} data-ein-button="true" className={cn(nativeLayout ? glassButtonVariants({variant:resolved,size:null}).replace(/^ein-button\s+/, "ein-native-button ") : glassButtonVariants({variant:resolved,size}),className)} {...props} />;
});
export { GlassButton, glassButtonVariants };
