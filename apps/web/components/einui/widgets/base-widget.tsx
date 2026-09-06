"use client"

import * as React from "react"
import { motion, type HTMLMotionProps, type Variants } from "motion/react"
import { cn } from "@/components/einui/utils"

interface GlassWidgetBaseProps extends Omit<HTMLMotionProps<"div">, "children"> {
  children: React.ReactNode
  size?: "sm" | "md" | "lg" | "xl"
  glowEffect?: boolean
  glowColor?: "cyan" | "purple" | "blue" | "pink" | "green" | "amber" | "red"
  hoverScale?: boolean
  interactive?: boolean
}

const sizeClasses = {
  sm: "ein:p-3",
  md: "ein:p-4",
  lg: "ein:p-5",
  xl: "ein:p-6",
}

const glowColors = {
  cyan: "ein:from-cyan-500/30 ein:via-blue-500/30 ein:to-purple-500/30",
  purple: "ein:from-purple-500/30 ein:via-pink-500/30 ein:to-purple-500/30",
  blue: "ein:from-blue-500/30 ein:via-indigo-500/30 ein:to-blue-500/30",
  pink: "ein:from-pink-500/30 ein:via-rose-500/30 ein:to-pink-500/30",
  green: "ein:from-emerald-500/30 ein:via-teal-500/30 ein:to-emerald-500/30",
  amber: "ein:from-amber-500/30 ein:via-orange-500/30 ein:to-amber-500/30",
  red: "ein:from-red-500/30 ein:via-rose-500/30 ein:to-red-500/30",
}

const widgetVariants = {
  hidden: { opacity: 0, y: 20, scale: 0.95 },
  visible: {
    opacity: 1,
    y: 0,
    scale: 1,
    transition: {
      type: "spring",
      visualDuration: 0.4,
      bounce: 0.2,
    },
  },
  hover: {
    y: -2,
    transition: {
      type: "spring",
      visualDuration: 0.3,
      bounce: 0.4,
    },
  },
} as const

const glowVariants: Variants = {
  initial: { opacity: 0.4, scale: 0.98 },
  animate: {
    opacity: [0.4, 0.6, 0.4] as number[],
    scale: [0.98, 1, 0.98] as number[],
    transition: {
      duration: 4,
      repeat: Number.POSITIVE_INFINITY,
      ease: "easeInOut",
    },
  },
  hover: {
    opacity: 0.8,
    scale: 1.02,
    transition: {
      type: "spring",
      visualDuration: 0.3,
      bounce: 0.3,
    },
  },
}

const GlassWidgetBase = React.forwardRef<HTMLDivElement, GlassWidgetBaseProps>(
  (
    {
      className,
      children,
      size = "md",
      glowEffect = true,
      glowColor = "cyan",
      hoverScale = true,
      interactive = true,
      ...props
    },
    ref,
  ) => {
    return (
      <motion.div
        className="ein:relative ein:h-full"
        initial="hidden"
        animate="visible"
        whileHover={interactive && hoverScale ? "hover" : undefined}
        variants={widgetVariants}
      >
        {/* Glow effect */}
        {glowEffect && (
          <motion.div
            className={cn("ein:absolute ein:-inset-0.5 ein:rounded-2xl ein:bg-linear-to-r ein:blur-xl", glowColors[glowColor])}
            variants={glowVariants}
            initial="initial"
            animate="animate"
            whileHover={interactive ? "hover" : undefined}
            aria-hidden="true"
          />
        )}

        {/* Widget container */}
        <motion.div
          ref={ref}
          className={cn(
            "ein:relative ein:h-full ein:rounded-2xl ein:border ein:border-white/20",
            "ein:bg-white/10 ein:backdrop-blur-xl",
            "ein:shadow-[0_8px_32px_rgba(0,0,0,0.37)]",
            // Inner highlight linear
            "ein:before:absolute ein:before:inset-0 ein:before:rounded-2xl",
            "ein:before:bg-linear-to-b ein:before:from-white/20 ein:before:to-transparent ein:before:pointer-events-none",
            // Inner shadow for depth
            "ein:after:absolute ein:after:inset-px ein:after:rounded-[calc(1rem-1px)]",
            "ein:after:shadow-[inset_0_1px_1px_rgba(255,255,255,0.1)] ein:after:pointer-events-none",
            sizeClasses[size],
            className,
          )}
          role="article"
          {...props}
        >
          <div className="ein:relative ein:z-10 ein:h-full">{children}</div>
        </motion.div>
      </motion.div>
    )
  },
)
GlassWidgetBase.displayName = "GlassWidgetBase"

export { GlassWidgetBase }
export type { GlassWidgetBaseProps }
