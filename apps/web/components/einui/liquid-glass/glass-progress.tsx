"use client"

import * as React from "react"
import * as ProgressPrimitive from "@radix-ui/react-progress"
import { cn } from "@/components/einui/utils"

const GlassProgress = React.forwardRef<
  React.ElementRef<typeof ProgressPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof ProgressPrimitive.Root>
>(({ className, value, ...props }, ref) => (
  <div className="ein:relative">
    <div className="ein:absolute ein:-inset-1 ein:rounded-full ein:bg-linear-to-r ein:from-cyan-500/20 ein:via-blue-500/20 ein:to-purple-500/20 ein:blur-md ein:opacity-50" />
    <ProgressPrimitive.Root
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
          "ein:bg-linear-to-r ein:from-cyan-400 ein:via-blue-400 ein:to-purple-400",
          "ein:shadow-[0_0_12px_rgba(59,130,246,0.5)]",
        )}
        style={{ width: `${value || 0}%` }}
      />
    </ProgressPrimitive.Root>
  </div>
))
GlassProgress.displayName = ProgressPrimitive.Root.displayName

export { GlassProgress }
