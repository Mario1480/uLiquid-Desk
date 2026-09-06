"use client"

import * as React from "react"
import * as ScrollAreaPrimitive from "@radix-ui/react-scroll-area"
import { cn } from "@/components/einui/utils"

const GlassScrollArea = React.forwardRef<
  React.ElementRef<typeof ScrollAreaPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof ScrollAreaPrimitive.Root>
>(({ className, children, ...props }, ref) => (
  <ScrollAreaPrimitive.Root ref={ref} className={cn("ein:relative ein:overflow-hidden", className)} {...props}>
    <ScrollAreaPrimitive.Viewport className="ein:h-full ein:w-full ein:rounded-[inherit]">{children}</ScrollAreaPrimitive.Viewport>
    <GlassScrollBar />
    <ScrollAreaPrimitive.Corner />
  </ScrollAreaPrimitive.Root>
))
GlassScrollArea.displayName = ScrollAreaPrimitive.Root.displayName

const GlassScrollBar = React.forwardRef<
  React.ElementRef<typeof ScrollAreaPrimitive.ScrollAreaScrollbar>,
  React.ComponentPropsWithoutRef<typeof ScrollAreaPrimitive.ScrollAreaScrollbar>
>(({ className, orientation = "vertical", ...props }, ref) => (
  <ScrollAreaPrimitive.ScrollAreaScrollbar
    ref={ref}
    orientation={orientation}
    className={cn(
      "ein:flex ein:touch-none ein:select-none ein:transition-colors",
      orientation === "vertical" && "ein:h-full ein:w-2.5 ein:border-l ein:border-l-transparent ein:p-[1px]",
      orientation === "horizontal" && "ein:h-2.5 ein:flex-col ein:border-t ein:border-t-transparent ein:p-[1px]",
      className,
    )}
    {...props}
  >
    <ScrollAreaPrimitive.ScrollAreaThumb
      className={cn("ein:relative ein:flex-1 ein:rounded-full", "ein:bg-white/20 ein:hover:bg-white/30 ein:transition-colors")}
    />
  </ScrollAreaPrimitive.ScrollAreaScrollbar>
))
GlassScrollBar.displayName = ScrollAreaPrimitive.ScrollAreaScrollbar.displayName

export { GlassScrollArea, GlassScrollBar }
