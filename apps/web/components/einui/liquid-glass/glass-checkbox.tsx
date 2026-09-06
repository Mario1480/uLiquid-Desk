"use client"

import * as React from "react"
import * as CheckboxPrimitive from "@radix-ui/react-checkbox"
import { motion, type Variants } from "motion/react"
import { Check } from "lucide-react"
import { cn } from "@/components/einui/utils"

const checkVariants: Variants = {
  initial: { scale: 0, opacity: 0 },
  checked: {
    scale: 1,
    opacity: 1,
    transition: {
      type: "spring",
      duration: 0.2,
      bounce: 0.5,
    },
  },
  unchecked: {
    scale: 0,
    opacity: 0,
    transition: {
      duration: 0.1,
    },
  },
}

export interface GlassCheckboxProps extends React.ComponentPropsWithoutRef<typeof CheckboxPrimitive.Root> {
  label?: string
}

const GlassCheckbox = React.forwardRef<React.ElementRef<typeof CheckboxPrimitive.Root>, GlassCheckboxProps>(
  ({ className, label, id, ...props }, ref) => {
    const checkboxId = id || "glass-checkbox-id"

    return (
      <div className="ein:flex ein:items-center ein:gap-3">
        <CheckboxPrimitive.Root
          ref={ref}
          id={checkboxId}
          className={cn(
            "ein:peer ein:h-5 ein:w-5 ein:shrink-0 ein:rounded-md",
            "ein:bg-white/10 ein:backdrop-blur-xl ein:border ein:border-white/30",
            "ein:shadow-[0_2px_8px_rgba(0,0,0,0.2)]",
            "ein:transition-all ein:duration-200",
            "ein:focus-visible:outline-none ein:focus-visible:ring-2 ein:focus-visible:ring-cyan-400/50 ein:focus-visible:ring-offset-2 ein:focus-visible:ring-offset-transparent",
            "ein:disabled:cursor-not-allowed ein:disabled:opacity-50",
            "ein:data-[state=checked]:bg-linear-to-r ein:data-[state=checked]:from-cyan-500/60 ein:data-[state=checked]:to-blue-500/60",
            "ein:data-[state=checked]:border-white/40",
            className,
          )}
          {...props}
        >
          <CheckboxPrimitive.Indicator className={cn("ein:flex ein:items-center ein:justify-center ein:text-white")} asChild>
            <motion.div variants={checkVariants} initial="initial" animate="checked" exit="unchecked">
              <Check className="ein:h-3.5 ein:w-3.5" strokeWidth={3} />
            </motion.div>
          </CheckboxPrimitive.Indicator>
        </CheckboxPrimitive.Root>
        {label && (
          <label
            htmlFor={checkboxId}
            className="ein:text-sm ein:font-medium ein:text-white/80 ein:cursor-pointer ein:select-none ein:peer-disabled:cursor-not-allowed ein:peer-disabled:opacity-50"
          >
            {label}
          </label>
        )}
      </div>
    )
  },
)
GlassCheckbox.displayName = CheckboxPrimitive.Root.displayName

export { GlassCheckbox }
