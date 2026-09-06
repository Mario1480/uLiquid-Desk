"use client"

import * as React from "react"
import * as SliderPrimitive from "@radix-ui/react-slider"
import { cn } from "@/components/einui/utils"

const GlassSlider = React.forwardRef<
  React.ElementRef<typeof SliderPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof SliderPrimitive.Root>
>(({ className, ...props }, ref) => (
  <SliderPrimitive.Root
    ref={ref}
    className={cn("ein:relative ein:flex ein:w-full ein:touch-none ein:select-none ein:items-center", className)}
    {...props}
  >
    <SliderPrimitive.Track
      className={cn(
        "ein:relative ein:h-2 ein:w-full ein:grow ein:overflow-hidden ein:rounded-full",
        "ein:bg-white/10 ein:backdrop-blur-xl ein:border ein:border-white/20",
      )}
    >
      <SliderPrimitive.Range
        className={cn(
          "ein:absolute ein:h-full ein:rounded-full",
          "ein:bg-linear-to-r ein:from-cyan-400 ein:via-blue-400 ein:to-purple-400",
          "ein:shadow-[0_0_8px_rgba(59,130,246,0.4)]",
        )}
      />
    </SliderPrimitive.Track>
    <SliderPrimitive.Thumb
      className={cn(
        "ein:block ein:h-5 ein:w-5 ein:rounded-full ein:cursor-grab ein:active:cursor-grabbing",
        "ein:bg-white ein:border-2 ein:border-white/50",
        "ein:shadow-[0_2px_10px_rgba(0,0,0,0.3)]",
        "ein:transition-all ein:duration-200",
        "ein:hover:scale-110 ein:hover:shadow-[0_0_16px_rgba(59,130,246,0.5)]",
        "ein:focus-visible:outline-none ein:focus-visible:ring-2 ein:focus-visible:ring-white/50",
        "ein:disabled:pointer-events-none ein:disabled:opacity-50",
      )}
    />
  </SliderPrimitive.Root>
))
GlassSlider.displayName = SliderPrimitive.Root.displayName

export { GlassSlider }
