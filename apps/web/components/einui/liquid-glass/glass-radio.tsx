"use client"

import * as React from "react"
import * as RadioGroupPrimitive from "@radix-ui/react-radio-group"
import { motion, Variants } from "motion/react"
import { cn } from "@/components/einui/utils"

const indicatorVariants = {
  initial: { scale: 0, opacity: 0 },
  checked: {
    scale: 1,
    opacity: 1,
    transition: {
      type: "spring",
      visualDuration: 0.2,
      bounce: 0.5,
    },
  },
}

const GlassRadioGroup = React.forwardRef<
  React.ElementRef<typeof RadioGroupPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof RadioGroupPrimitive.Root>
>(({ className, ...props }, ref) => {
  return <RadioGroupPrimitive.Root className={cn("ein:grid ein:gap-3", className)} {...props} ref={ref} />
})
GlassRadioGroup.displayName = RadioGroupPrimitive.Root.displayName

export interface GlassRadioGroupItemProps extends React.ComponentPropsWithoutRef<typeof RadioGroupPrimitive.Item> {
  label?: string
}

const GlassRadioGroupItem = React.forwardRef<
  React.ElementRef<typeof RadioGroupPrimitive.Item>,
  GlassRadioGroupItemProps
>(({ className, label, id, ...props }, ref) => {
  const radioId = id || `glass-radio-${props.value}`

  return (
    <div className="ein:flex ein:items-center ein:gap-3">
      <RadioGroupPrimitive.Item
        ref={ref}
        id={radioId}
        className={cn(
          "ein:aspect-square ein:h-5 ein:w-5 ein:rounded-full",
          "ein:bg-white/10 ein:backdrop-blur-xl ein:border ein:border-white/30",
          "ein:shadow-[0_2px_8px_rgba(0,0,0,0.2)]",
          "ein:transition-all ein:duration-200",
          "ein:focus:outline-none ein:focus-visible:ring-2 ein:focus-visible:ring-cyan-400/50 ein:focus-visible:ring-offset-2 ein:focus-visible:ring-offset-transparent",
          "ein:disabled:cursor-not-allowed ein:disabled:opacity-50",
          "ein:data-[state=checked]:border-cyan-400/60",
          className,
        )}
        {...props}
      >
        <RadioGroupPrimitive.Indicator className="ein:flex ein:w-full ein:h-full ein:items-center ein:justify-center">
          <motion.div
            className="ein:h-2.5 ein:w-2.5 ein:rounded-full ein:bg-linear-to-r ein:from-cyan-400 ein:to-blue-400"
            initial="initial"
            animate="checked"
            variants={indicatorVariants as Variants}
            transition={{
              type: "spring",
              visualDuration: 0.2,
              bounce: 0.5,
            }}
          />
        </RadioGroupPrimitive.Indicator>
      </RadioGroupPrimitive.Item>
      {label && (
        <label htmlFor={radioId} className="ein:text-sm ein:font-medium ein:text-white/80 ein:cursor-pointer ein:select-none">
          {label}
        </label>
      )}
    </div>
  )
})
GlassRadioGroupItem.displayName = RadioGroupPrimitive.Item.displayName

export { GlassRadioGroup, GlassRadioGroupItem }
