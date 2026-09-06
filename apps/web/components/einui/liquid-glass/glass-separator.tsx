"use client"

import * as React from "react"
import { Separator as SeparatorPrimitive } from "radix-ui"
import { cn } from "@/components/einui/utils"

const GlassSeparator = React.forwardRef<
  React.ElementRef<typeof SeparatorPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof SeparatorPrimitive.Root>
>(({ className, orientation = "horizontal", decorative = true, ...props }, ref) => (
  <SeparatorPrimitive.Root
    ref={ref}
    decorative={decorative}
    orientation={orientation}
    className={cn(
      "ein:shrink-0 ein:bg-gradient-to-r ein:from-transparent ein:via-white/20 ein:to-transparent",
      orientation === "horizontal" ? "ein:h-px ein:w-full" : "ein:h-full ein:w-px",
      className,
    )}
    {...props}
  />
))
GlassSeparator.displayName = SeparatorPrimitive.Root.displayName

export { GlassSeparator }
