"use client"

import * as React from "react"
import * as SwitchPrimitive from "@radix-ui/react-switch"
import { cn } from "@/components/einui/utils"

const GlassSwitch = React.forwardRef<
  React.ElementRef<typeof SwitchPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof SwitchPrimitive.Root>
>(({ className, ...props }, ref) => (
  <SwitchPrimitive.Root
    className={cn(
      "ein:peer ein:inline-flex ein:h-6 ein:w-11 ein:shrink-0 ein:cursor-pointer ein:items-center ein:rounded-full",
      "ein:border ein:border-white/20 ein:transition-all ein:duration-300",
      "ein:bg-white/10 ein:backdrop-blur-xl",
      "ein:focus-visible:outline-none ein:focus-visible:ring-2 ein:focus-visible:ring-white/50",
      "ein:disabled:cursor-not-allowed ein:disabled:opacity-50",
      "ein:data-[state=checked]:bg-linear-to-r ein:data-[state=checked]:from-cyan-500/60 ein:data-[state=checked]:to-blue-500/60",
      "ein:data-[state=checked]:border-cyan-400/40",
      "ein:data-[state=checked]:shadow-[0_0_12px_rgba(6,182,212,0.4)]",
      className,
    )}
    {...props}
    ref={ref}
  >
    <SwitchPrimitive.Thumb
      className={cn(
        "ein:pointer-events-none ein:block ein:h-5 ein:w-5 ein:rounded-full",
        "ein:bg-white ein:shadow-[0_2px_8px_rgba(0,0,0,0.3)]",
        "ein:transition-transform ein:duration-300",
        "ein:data-[state=checked]:translate-x-5 ein:data-[state=unchecked]:translate-x-0.5",
      )}
    />
  </SwitchPrimitive.Root>
))
GlassSwitch.displayName = SwitchPrimitive.Root.displayName

export { GlassSwitch }
