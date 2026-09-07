"use client"

import * as React from "react"
import * as ProgressPrimitive from "@radix-ui/react-progress"
import { cn } from "@/components/einui/utils"

const GlassProgress = React.forwardRef<
  React.ElementRef<typeof ProgressPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof ProgressPrimitive.Root>
>(({ className, value, max = 100, ...props }, ref) => (
  <div className="ein:relative">
    <ProgressPrimitive.Root
      value={value}
      max={max}
      ref={ref}
      className={cn(
        "ein:relative ein:h-3 ein:w-full ein:overflow-hidden ein:rounded-full",
        "ein:bg-white/10 ein:backdrop-blur-xl ein:border ein:border-white/20",
        className,
      )}
      {...props}
    >
      <ProgressPrimitive.Indicator
        className={cn(
          "ein:h-full ein:transition-all ein:duration-500 ein:ease-out ein:rounded-full",
          "ein:bg-primary",
          "ein:shadow-[0_0_12px_rgba(59,130,246,0.5)]",
        )}
        style={{ width: `${Math.max(0, Math.min(100, ((value ?? 0) / (max > 0 ? max : 100)) * 100))}%` }}
      />
    </ProgressPrimitive.Root>
  </div>
))
GlassProgress.displayName = ProgressPrimitive.Root.displayName

export { GlassProgress }
