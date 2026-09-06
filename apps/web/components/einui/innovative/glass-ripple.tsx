"use client"

import * as React from "react"
import { GlassButton } from "../liquid-glass/glass-button"
import { cn } from "@/components/einui/utils"

interface Ripple {
  id: number
  x: number
  y: number
  size: number
}

interface GlassRippleProps extends React.HTMLAttributes<HTMLDivElement> {
  color?: "cyan" | "purple" | "white" | "blue"
  duration?: number
  disabled?: boolean
}

const rippleColors = {
  cyan: "ein:bg-cyan-400/30",
  purple: "ein:bg-purple-400/30",
  white: "ein:bg-white/30",
  blue: "ein:bg-blue-400/30",
}

const GlassRipple = React.forwardRef<HTMLDivElement, GlassRippleProps>(
  ({ className, children, color = "white", duration = 600, disabled = false, ...props }, ref) => {
    const [ripples, setRipples] = React.useState<Ripple[]>([])
    const containerRef = React.useRef<HTMLDivElement>(null)

    const createRipple = React.useCallback(
      (e: React.MouseEvent<HTMLDivElement> | React.TouchEvent<HTMLDivElement>) => {
        if (disabled || !containerRef.current) return

        const rect = containerRef.current.getBoundingClientRect()
        let x: number, y: number

        if ("touches" in e) {
          x = e.touches[0].clientX - rect.left
          y = e.touches[0].clientY - rect.top
        } else {
          x = e.clientX - rect.left
          y = e.clientY - rect.top
        }

        const size = Math.max(rect.width, rect.height) * 2

        const newRipple: Ripple = {
          id: Date.now(),
          x,
          y,
          size,
        }

        setRipples((prev) => [...prev, newRipple])

        setTimeout(() => {
          setRipples((prev) => prev.filter((r) => r.id !== newRipple.id))
        }, duration)
      },
      [disabled, duration],
    )

    return (
      <div ref={ref} className={cn("ein:relative ein:overflow-hidden ein:cursor-pointer", className)} {...props}>
        <div ref={containerRef} className="ein:absolute ein:inset-0" onMouseDown={createRipple} onTouchStart={createRipple}>
          {ripples.map((ripple) => (
            <span
              key={ripple.id}
              className={cn(
                "ein:absolute ein:rounded-full ein:pointer-events-none",
                "ein:animate-[ein-ripple_0.6s_ease-out_forwards]",
                rippleColors[color],
              )}
              style={{
                left: ripple.x - ripple.size / 2,
                top: ripple.y - ripple.size / 2,
                width: ripple.size,
                height: ripple.size,
              }}
            />
          ))}
        </div>
        <div className="ein:relative ein:z-10 ein:pointer-events-none">{children}</div>
      </div>
    )
  },
)
GlassRipple.displayName = "GlassRipple"

// Button with built-in ripple
interface GlassRippleButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "default" | "primary" | "outline"
  rippleColor?: "cyan" | "purple" | "white" | "blue"
}

const GlassRippleButton = React.forwardRef<HTMLButtonElement, GlassRippleButtonProps>(
  ({rippleColor: _rippleColor, ...props}, ref) => <GlassButton ref={ref} {...props} />,
)
GlassRippleButton.displayName = "GlassRippleButton"

export { GlassRipple, GlassRippleButton }
