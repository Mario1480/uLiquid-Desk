"use client"

import * as React from "react"
import { cn } from "@/components/einui/utils"

interface GlassGaugeProps extends React.HTMLAttributes<HTMLDivElement> {
  value: number
  max?: number
  size?: "sm" | "md" | "lg"
  showValue?: boolean
  label?: string
  colorScheme?: "cyan" | "purple" | "green" | "orange" | "gradient"
  animated?: boolean
}

const sizes = {
  sm: { size: 100, strokeWidth: 8, fontSize: "ein:text-lg" },
  md: { size: 150, strokeWidth: 10, fontSize: "ein:text-2xl" },
  lg: { size: 200, strokeWidth: 12, fontSize: "ein:text-4xl" },
}

const colorSchemes = {
  cyan: { stroke: "ein:stroke-cyan-500", glow: "ein:from-cyan-500/40 ein:to-blue-500/40" },
  purple: { stroke: "ein:stroke-purple-500", glow: "ein:from-purple-500/40 ein:to-pink-500/40" },
  green: { stroke: "ein:stroke-emerald-500", glow: "ein:from-emerald-500/40 ein:to-teal-500/40" },
  orange: { stroke: "ein:stroke-orange-500", glow: "ein:from-orange-500/40 ein:to-amber-500/40" },
  gradient: { stroke: "", glow: "ein:from-cyan-500/40 ein:via-blue-500/40 ein:to-purple-500/40" },
}

const GlassGauge = React.forwardRef<HTMLDivElement, GlassGaugeProps>(
  (
    {
      className,
      value,
      max = 100,
      size = "md",
      showValue = true,
      label,
      colorScheme = "cyan",
      animated = true,
      ...props
    },
    ref,
  ) => {
    const [displayValue, setDisplayValue] = React.useState(0)
    const config = sizes[size]
    const colors = colorSchemes[colorScheme]
    const percentage = Math.min(Math.max((value / max) * 100, 0), 100)

    const radius = (config.size - config.strokeWidth) / 2
    const circumference = radius * 2 * Math.PI
    const strokeDashoffset = circumference - (percentage / 100) * circumference

    React.useEffect(() => {
      if (!animated) {
        setDisplayValue(value)
        return
      }

      const duration = 1000
      const steps = 60
      const increment = value / steps
      let current = 0
      let step = 0

      const timer = setInterval(() => {
        step++
        current = Math.min(current + increment, value)
        setDisplayValue(Math.round(current))

        if (step >= steps) {
          clearInterval(timer)
          setDisplayValue(value)
        }
      }, duration / steps)

      return () => clearInterval(timer)
    }, [value, animated])

    const gradientId = React.useId()

    return (
      <div ref={ref} className={cn("ein:relative ein:inline-flex ein:flex-col ein:items-center", className)} {...props}>
        {/* Glow effect */}
        <div
          className={cn("ein:absolute ein:rounded-full ein:bg-linear-to-r ein:blur-xl ein:opacity-60", colors.glow)}
          style={{
            width: config.size * 0.8,
            height: config.size * 0.8,
            top: "50%",
            left: "50%",
            transform: "translate(-50%, -50%)",
          }}
        />

        <div className="ein:relative" style={{ width: config.size, height: config.size }}>
          <svg width={config.size} height={config.size} className="ein:transform ein:-rotate-90">
            {/* Gradient definition */}
            {colorScheme === "gradient" && (
              <defs>
                <linearGradient id={gradientId} x1="0%" y1="0%" x2="100%" y2="0%">
                  <stop offset="0%" stopColor="#06b6d4" />
                  <stop offset="50%" stopColor="#3b82f6" />
                  <stop offset="100%" stopColor="#a855f7" />
                </linearGradient>
              </defs>
            )}

            {/* Background track */}
            <circle
              cx={config.size / 2}
              cy={config.size / 2}
              r={radius}
              fill="none"
              stroke="currentColor"
              strokeWidth={config.strokeWidth}
              className="ein:text-white/10"
            />

            {/* Glass reflection on track */}
            <circle
              cx={config.size / 2}
              cy={config.size / 2}
              r={radius - config.strokeWidth / 2}
              fill="none"
              stroke="currentColor"
              strokeWidth={1}
              className="ein:text-white/5"
            />

            {/* Progress arc */}
            <circle
              cx={config.size / 2}
              cy={config.size / 2}
              r={radius}
              fill="none"
              stroke={colorScheme === "gradient" ? `url(#${gradientId})` : undefined}
              strokeWidth={config.strokeWidth}
              strokeLinecap="round"
              strokeDasharray={circumference}
              strokeDashoffset={strokeDashoffset}
              className={cn("ein:transition-all ein:duration-1000 ein:ease-out", colorScheme !== "gradient" && colors.stroke)}
            />
          </svg>

          {/* Center content */}
          <div className="ein:absolute ein:inset-0 ein:flex ein:flex-col ein:items-center ein:justify-center">
            {showValue && (
              <span className={cn("ein:font-bold ein:text-white", config.fontSize)}>
                {displayValue}
                <span className="ein:text-white/70 ein:text-sm">%</span>
              </span>
            )}
            {label && <span className="ein:text-white/60 ein:text-sm ein:mt-1">{label}</span>}
          </div>
        </div>
      </div>
    )
  },
)
GlassGauge.displayName = "GlassGauge"

export { GlassGauge }
