"use client"

import * as React from "react"
import { EinPortalTheme } from "../portal-theme"
import { Tooltip as TooltipPrimitive } from "radix-ui"
import { cn } from "@/components/einui/utils"

const GlassTooltipProvider = TooltipPrimitive.Provider

const GlassTooltip = TooltipPrimitive.Root

const GlassTooltipTrigger = TooltipPrimitive.Trigger

const GlassTooltipContent = React.forwardRef<
  React.ElementRef<typeof TooltipPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TooltipPrimitive.Content>
>(({ className, sideOffset = 4, ...props }, ref) => (
  <TooltipPrimitive.Portal><EinPortalTheme>
    <TooltipPrimitive.Content
      ref={ref}
      sideOffset={sideOffset}
      className={cn(
        "ein:z-50 ein:overflow-hidden ein:rounded-lg ein:px-3 ein:py-1.5",
        "ein:bg-white/15 ein:backdrop-blur-xl ein:border ein:border-white/20",
        "ein:text-xs ein:text-white ein:shadow-[0_4px_16px_rgba(0,0,0,0.3)]",
        "ein:animate-in ein:fade-in-0 ein:zoom-in-95",
        "ein:data-[state=closed]:animate-out ein:data-[state=closed]:fade-out-0 ein:data-[state=closed]:zoom-out-95",
        "ein:data-[side=bottom]:slide-in-from-top-2 ein:data-[side=left]:slide-in-from-right-2",
        "ein:data-[side=right]:slide-in-from-left-2 ein:data-[side=top]:slide-in-from-bottom-2",
        className,
      )}
      {...props}
    />
  </EinPortalTheme></TooltipPrimitive.Portal>
))
GlassTooltipContent.displayName = TooltipPrimitive.Content.displayName

export { GlassTooltip, GlassTooltipTrigger, GlassTooltipContent, GlassTooltipProvider }
