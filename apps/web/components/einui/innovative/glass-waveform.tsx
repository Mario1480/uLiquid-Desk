"use client"

import * as React from "react"
import { cn } from "@/components/einui/utils"

interface GlassWaveformProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Base amplitude of the waveform (clamped to 0–1). */
  amplitude?: number
  /** Number of frequency bars (clamped to 4–96). */
  bars?: number
  /** Color scheme for the bars. */
  color?: "cyan" | "purple" | "emerald" | "gradient"
  /** Freezes the visualizer into a "frozen glass" state. */
  paused?: boolean
  /** Shows a readout of the current visualizer settings. */
  showLabels?: boolean
}

const DEFAULT_BARS = 32
const MIN_BARS = 4
const MAX_BARS = 96
const MAX_BAR_HEIGHT = 60

const colorVariants = {
  cyan: "ein:from-cyan-400 ein:to-blue-500",
  purple: "ein:from-fuchsia-400 ein:to-violet-500",
  emerald: "ein:from-emerald-400 ein:to-teal-500",
  gradient: "ein:from-cyan-400 ein:via-blue-400 ein:to-purple-400",
}

/** Deterministic seed so server and client render identical initial bars. */
function seedHeight(index: number) {
  return 0.25 + 0.5 * Math.abs(Math.sin(index * 1.7 + 0.4))
}

const GlassWaveform = React.forwardRef<HTMLDivElement, GlassWaveformProps>(
  (
    {
      className,
      amplitude = 0.8,
      bars = DEFAULT_BARS,
      color = "gradient",
      paused = false,
      showLabels = false,
      ...props
    },
    ref,
  ) => {
    const gradientId = React.useId()
    const barRefs = React.useRef<Array<HTMLDivElement | null>>([])
    const frameRef = React.useRef<number | null>(null)
    const [reducedMotion, setReducedMotion] = React.useState(false)

    const barCount = Math.max(MIN_BARS, Math.min(MAX_BARS, Math.round(bars)))
    const amplitudeSafe = Math.max(0, Math.min(1, amplitude))

    // Respect the user's reduced-motion preference.
    React.useEffect(() => {
      if (typeof window.matchMedia !== "function") return

      const mql = window.matchMedia("(prefers-reduced-motion: reduce)")
      const onChange = () => setReducedMotion(mql.matches)
      onChange()
      mql.addEventListener("change", onChange)
      return () => mql.removeEventListener("change", onChange)
    }, [])

    // Bar refs are populated by the ref callbacks below on every commit; do NOT
    // clear them here (a post-mount clear would wipe the DOM nodes the animation
    // loop reads and leave the visualizer frozen on the initial mount).

    // Animate the bars by writing heights directly to the DOM (no re-renders).
    React.useEffect(() => {
      if (paused || reducedMotion) return

      // Resume smoothly from the current (possibly frozen) heights.
      const heights = barRefs.current.map((node, index) => {
        const current = node ? parseFloat(node.style.height) : Number.NaN
        return Number.isFinite(current) ? (current - 16) / MAX_BAR_HEIGHT : seedHeight(index)
      })

      const update = (time: number) => {
        for (let index = 0; index < barCount; index++) {
          const node = barRefs.current[index]
          if (!node) continue

          const drift = Math.sin(time / 450 + index * 0.35) * 0.14
          const target = 0.15 + Math.abs(Math.sin(time / 300 + index * 0.25)) * amplitudeSafe
          heights[index] = Math.max(
            0.05,
            Math.min(1, heights[index] + (target - heights[index]) * 0.16 + drift * 0.04),
          )

          node.style.height = `${16 + heights[index] * MAX_BAR_HEIGHT}px`
        }

        frameRef.current = window.requestAnimationFrame(update)
      }

      frameRef.current = window.requestAnimationFrame(update)
      return () => {
        if (frameRef.current) window.cancelAnimationFrame(frameRef.current)
      }
    }, [amplitudeSafe, barCount, paused, reducedMotion])

    const gradientClass = colorVariants[color]

    return (
      <div
        ref={ref}
        className={cn(
          "ein:relative ein:overflow-hidden ein:rounded-4xl ein:border ein:border-white/10 ein:bg-black/25 ein:backdrop-blur-xl",
          className,
        )}
        {...props}
      >
        <div className="ein:absolute ein:inset-0 ein:bg-[radial-gradient(circle_at_top_left,rgba(255,255,255,0.18),transparent_25%),radial-gradient(circle_at_bottom_right,rgba(59,130,246,0.12),transparent_30%)]" />

        {/* Decorative drawing — hidden from assistive technology. */}
        <div className="ein:relative ein:h-52 ein:px-4 ein:py-5" aria-hidden="true">
          <div className="ein:absolute ein:inset-x-4 ein:top-4 ein:h-0.5 ein:bg-white/10" />
          <div className="ein:absolute ein:inset-x-4 ein:bottom-4 ein:h-0.5 ein:bg-white/10" />

          <div className="ein:absolute ein:inset-0 ein:pointer-events-none">
            <svg viewBox="0 0 100 100" className="ein:w-full ein:h-full ein:opacity-30">
              <defs>
                <linearGradient id={gradientId} x1="0%" y1="0%" x2="100%" y2="0%">
                  <stop offset="0%" stopColor="#22d3ee" />
                  <stop offset="50%" stopColor="#818cf8" />
                  <stop offset="100%" stopColor="#e879f9" />
                </linearGradient>
              </defs>
              <path
                d="M0,60 C20,40 40,65 50,45 C60,25 80,50 100,35"
                fill="none"
                stroke={`url(#${gradientId})`}
                strokeWidth="1.4"
                opacity="0.75"
              />
            </svg>
          </div>

          <div className="ein:relative ein:h-full ein:flex ein:items-center ein:justify-between ein:gap-2">
            {Array.from({ length: barCount }, (_, index) => (
              <div key={index} className="ein:flex-1 ein:h-full ein:flex ein:flex-col ein:justify-end">
                <div
                  ref={(node) => {
                    barRefs.current[index] = node
                  }}
                  className={cn(
                    "ein:mx-auto ein:w-full ein:rounded-full",
                    paused ? "ein:bg-white/10" : `ein:bg-linear-to-t ${gradientClass}`,
                  )}
                  style={{
                    height: 16 + seedHeight(index) * MAX_BAR_HEIGHT,
                    minHeight: 4,
                    transition: "background 300ms ease",
                  }}
                >
                  <div className="ein:h-full ein:rounded-full ein:bg-white/10 ein:mix-blend-screen" />
                </div>
              </div>
            ))}
          </div>

          <div className="ein:pointer-events-none ein:absolute ein:inset-x-4 ein:top-6 ein:h-0.75 ein:bg-white/10 ein:blur-sm" />
        </div>

        <div className="ein:border-t ein:border-white/10 ein:px-5 ein:py-3 ein:bg-black/40 ein:backdrop-blur-xl">
          <div className="ein:flex ein:items-center ein:justify-between ein:gap-4 ein:text-xs ein:uppercase ein:tracking-[0.3em] ein:text-white/60">
            <span className="ein:font-semibold">Audio Visualizer</span>
            <span className={cn(paused ? "ein:text-rose-200" : "ein:text-emerald-200")}>
              {paused ? "Frozen Glass" : "Live"}
            </span>
          </div>
          {showLabels ? (
            <div className="ein:mt-3 ein:grid ein:grid-cols-3 ein:gap-3 ein:text-[11px] ein:text-white/70">
              <span>Amplitude {Math.round(amplitudeSafe * 100)}%</span>
              <span>Bars {barCount}</span>
              <span>Mode {paused ? "Paused" : "Active"}</span>
            </div>
          ) : null}
        </div>
      </div>
    )
  },
)

GlassWaveform.displayName = "GlassWaveform"

export { GlassWaveform }
export type { GlassWaveformProps }
