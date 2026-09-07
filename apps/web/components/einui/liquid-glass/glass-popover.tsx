"use client"

import * as React from "react"
import { EinPortalTheme } from "../portal-theme"
import * as PopoverPrimitive from "@radix-ui/react-popover"
import { cn } from "@/components/einui/utils"

const GlassPopover = PopoverPrimitive.Root

const GlassPopoverTrigger = PopoverPrimitive.Trigger

const GlassPopoverAnchor = PopoverPrimitive.Anchor

const GlassPopoverContent = React.forwardRef<
  React.ElementRef<typeof PopoverPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof PopoverPrimitive.Content>
>(({ className, align = "center", sideOffset = 4, ...props }, ref) => (
  <PopoverPrimitive.Portal><EinPortalTheme>
    <PopoverPrimitive.Content
      data-ein-overlay="true"
      ref={ref}
      align={align}
      sideOffset={sideOffset}
      className={cn(
        "ein:z-50 ein:w-72 ein:rounded-xl ein:p-4",
        " ein:border ein:border-white/20",
        "",
        "ein:outline-none",
        "ein:data-[state=open]:animate-in ein:data-[state=closed]:animate-out",
        "ein:data-[state=closed]:fade-out-0 ein:data-[state=open]:fade-in-0",
        "ein:data-[state=closed]:zoom-out-95 ein:data-[state=open]:zoom-in-95",
        "ein:data-[side=bottom]:slide-in-from-top-2",
        "ein:data-[side=left]:slide-in-from-right-2",
        "ein:data-[side=right]:slide-in-from-left-2",
        "ein:data-[side=top]:slide-in-from-bottom-2",
        // Glass highlight
        "ein:before:absolute ein:before:inset-0 ein:before:rounded-xl",
        "ein:before:bg-linear-to-b ein:before:from-white/15 ein:before:to-transparent ein:before:pointer-events-none",
        className,
      )}
      {...props}
    />
  </EinPortalTheme></PopoverPrimitive.Portal>
))
GlassPopoverContent.displayName = PopoverPrimitive.Content.displayName

export { GlassPopover, GlassPopoverTrigger, GlassPopoverContent, GlassPopoverAnchor }
