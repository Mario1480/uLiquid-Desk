"use client"

import * as React from "react"
import { cn } from "@/components/einui/utils"

interface DockItem {
  id: string
  icon: React.ReactNode
  label: string
  href?: string
  onClick?: () => void
  active?: boolean
}

type DockOrientation = "horizontal" | "vertical"

interface GlassDockProps extends React.HTMLAttributes<HTMLDivElement> {
  items: DockItem[]
  magnification?: number
  baseSize?: number
  maxSize?: number
  orientation?: DockOrientation
  glassIntensity?: "low" | "medium" | "high"
}

const glassConfig = {
  low: {
    bg: "ein:bg-white/5",
    blur: "ein:backdrop-blur-xl",
    border: "ein:border-white/10",
    itemBg: "ein:bg-white/5",
    itemHover: "ein:hover:bg-white/10",
  },
  medium: {
    bg: "ein:bg-white/10",
    blur: "ein:backdrop-blur-2xl",
    border: "ein:border-white/20",
    itemBg: "ein:bg-white/10",
    itemHover: "ein:hover:bg-white/20",
  },
  high: {
    bg: "ein:bg-white/15",
    blur: "ein:backdrop-blur-3xl",
    border: "ein:border-white/30",
    itemBg: "ein:bg-white/15",
    itemHover: "ein:hover:bg-white/25",
  },
}

const GlassDock = React.forwardRef<HTMLDivElement, GlassDockProps>(
  (
    {
      className,
      items,
      magnification = 1.5,
      baseSize = 48,
      maxSize = 72,
      orientation = "horizontal",
      glassIntensity = "high",
      ...props
    },
    ref,
  ) => {
    const [hoveredIndex, setHoveredIndex] = React.useState<number | null>(null)
    const [mousePos, setMousePos] = React.useState<number | null>(null)
    const dockRef = React.useRef<HTMLDivElement>(null)
    const glass = glassConfig[glassIntensity]
    const isVertical = orientation === "vertical"

    const handleMouseMove = React.useCallback(
      (e: React.MouseEvent) => {
        if (!dockRef.current) return
        const rect = dockRef.current.getBoundingClientRect()
        setMousePos(isVertical ? e.clientY - rect.top : e.clientX - rect.left)
      },
      [isVertical],
    )

    const handleMouseLeave = React.useCallback(() => {
      setMousePos(null)
      setHoveredIndex(null)
    }, [])

    const getScale = React.useCallback(
      (index: number) => {
        if (mousePos === null) return 1

        const itemSize = baseSize + 16
        const itemCenter = index * itemSize + itemSize / 2
        const distance = Math.abs(mousePos - itemCenter)
        const maxDistance = itemSize * 2

        if (distance > maxDistance) return 1

        const scale = 1 + (magnification - 1) * (1 - distance / maxDistance)
        return Math.min(scale, magnification)
      },
      [mousePos, baseSize, magnification],
    )

    return (
      <div ref={ref} className={cn("ein:relative", className)} {...props}>
        <div
          className={cn(
            "ein:absolute ein:rounded-3xl ein:opacity-60 ein:blur-2xl",
            "ein:bg-linear-to-r ein:from-cyan-500/30 ein:via-blue-500/25 ein:to-purple-500/30",
            isVertical ? "ein:-inset-y-4 ein:-inset-x-6" : "ein:-inset-x-4 ein:-inset-y-6",
          )}
        />
        <div
          className={cn(
            "ein:absolute ein:rounded-3xl ein:opacity-40 ein:blur-xl",
            "ein:bg-linear-to-r ein:from-white/20 ein:to-white/10",
            isVertical ? "ein:-inset-y-2 ein:-inset-x-3" : "ein:-inset-x-2 ein:-inset-y-3",
          )}
        />

        <div
          ref={dockRef}
          onMouseMove={handleMouseMove}
          onMouseLeave={handleMouseLeave}
          role="toolbar"
          aria-label="Application dock"
          className={cn(
            "ein:relative ein:gap-2 ein:px-4 ein:py-3 ein:rounded-2xl",
            glass.bg,
            glass.blur,
            glass.border,
            "ein:border",
            "ein:shadow-[0_8px_32px_rgba(0,0,0,0.3),inset_0_1px_1px_rgba(255,255,255,0.2),inset_0_-1px_1px_rgba(0,0,0,0.1)]",
            isVertical ? "ein:flex ein:flex-col ein:items-center" : "ein:flex ein:items-end",
          )}
        >
          <div className="ein:absolute ein:inset-0 ein:rounded-2xl ein:bg-linear-to-b ein:from-white/20 ein:via-white/5 ein:to-transparent ein:pointer-events-none" />
          <div className="ein:absolute ein:inset-0 ein:rounded-2xl ein:bg-linear-to-tr ein:from-transparent ein:via-white/5 ein:to-white/15 ein:pointer-events-none" />
          <div className="ein:absolute ein:inset-x-0 ein:top-0 ein:h-px ein:bg-linear-to-r ein:from-transparent ein:via-white/40 ein:to-transparent ein:pointer-events-none" />

          <div className="ein:absolute ein:inset-0 ein:rounded-2xl ein:shadow-[inset_0_2px_4px_rgba(0,0,0,0.1)] ein:pointer-events-none" />

          {items.map((item, index) => {
            const scale = getScale(index)
            const isHovered = hoveredIndex === index
            const size = baseSize * scale

            const DockItemContent = (
              <div
                key={item.id}
                className={cn("ein:relative ein:flex ein:items-center", isVertical ? "ein:flex-row" : "ein:flex-col")}
                onMouseEnter={() => setHoveredIndex(index)}
                style={{
                  [isVertical ? "width" : "height"]: maxSize,
                  display: "flex",
                  [isVertical ? "justifyContent" : "alignItems"]: "flex-end",
                }}
              >
                <div
                  className={cn(
                    "ein:absolute ein:px-3 ein:py-1.5 ein:rounded-xl",
                    "ein:bg-white/15 ein:backdrop-blur-2xl ein:border ein:border-white/30",
                    "ein:text-white ein:text-sm ein:font-medium ein:whitespace-nowrap",
                    "ein:shadow-[0_4px_16px_rgba(0,0,0,0.2),inset_0_1px_1px_rgba(255,255,255,0.2)]",
                    "ein:transition-all ein:duration-200",
                    isVertical
                      ? cn(
                          "ein:-right-2 ein:translate-x-full",
                          isHovered ? "ein:opacity-100 ein:translate-x-full" : "ein:opacity-0 ein:translate-x-[calc(100%-8px)]",
                        )
                      : cn("ein:-top-12", isHovered ? "ein:opacity-100 ein:translate-y-0" : "ein:opacity-0 ein:translate-y-2"),
                    !isHovered && "ein:pointer-events-none",
                  )}
                >
                  {/* Tooltip glass highlight */}
                  <div className="ein:absolute ein:inset-0 ein:rounded-xl ein:bg-linear-to-b ein:from-white/15 ein:to-transparent ein:pointer-events-none" />
                  <span className="ein:relative">{item.label}</span>
                  <div
                    className={cn(
                      "ein:absolute ein:w-2.5 ein:h-2.5 ein:bg-white/15 ein:backdrop-blur-2xl ein:border ein:border-white/30",
                      "ein:transform ein:rotate-45",
                      isVertical
                        ? "ein:left-0 ein:top-1/2 ein:-translate-x-1/2 ein:-translate-y-1/2 ein:border-t-0 ein:border-r-0"
                        : "ein:left-1/2 ein:-bottom-1.5 ein:-translate-x-1/2 ein:border-t-0 ein:border-l-0",
                    )}
                  />
                </div>

                <button
                  onClick={item.onClick}
                  aria-label={item.label}
                  className={cn(
                    "ein:relative ein:flex ein:items-center ein:justify-center ein:rounded-xl",
                    glass.itemBg,
                    "ein:backdrop-blur-xl ein:border ein:border-white/20",
                    "ein:transition-all ein:duration-200 ein:ease-out",
                    glass.itemHover,
                    "ein:shadow-[0_2px_8px_rgba(0,0,0,0.15),inset_0_1px_1px_rgba(255,255,255,0.15)]",
                    item.active &&
                      "ein:bg-white/25 ein:border-white/40 ein:shadow-[0_4px_16px_rgba(0,0,0,0.2),inset_0_1px_1px_rgba(255,255,255,0.3)]",
                  )}
                  style={{
                    width: size,
                    height: size,
                    transform: isVertical
                      ? `translateX(${(maxSize - size) / 2}px)`
                      : `translateY(${(maxSize - size) / 2}px)`,
                  }}
                >
                  {/* Button glass highlights */}
                  <div className="ein:absolute ein:inset-0 ein:rounded-xl ein:bg-linear-to-b ein:from-white/20 ein:to-transparent ein:pointer-events-none" />
                  <div className="ein:absolute ein:inset-0 ein:rounded-xl ein:bg-linear-to-tr ein:from-transparent ein:to-white/10 ein:pointer-events-none" />

                  {/* Active glow */}
                  {item.active && (
                    <div className="ein:absolute ein:-inset-1.5 ein:rounded-2xl ein:bg-linear-to-r ein:from-cyan-500/40 ein:to-blue-500/40 ein:blur-md ein:-z-10" />
                  )}

                  <span
                    className="ein:relative ein:text-white/90"
                    style={{
                      transform: `scale(${scale})`,
                      transition: "transform 0.2s ease-out",
                    }}
                  >
                    {item.icon}
                  </span>
                </button>

                {item.active && (
                  <div
                    className={cn(
                      "ein:absolute ein:w-1.5 ein:h-1.5 ein:rounded-full",
                      "ein:bg-linear-to-r ein:from-cyan-400 ein:to-blue-400",
                      "ein:shadow-[0_0_8px_rgba(6,182,212,0.8),0_0_16px_rgba(6,182,212,0.4)]",
                      isVertical ? "ein:-left-1" : "ein:-bottom-1",
                    )}
                  />
                )}
              </div>
            )

            if (item.href) {
              return (
                <a key={item.id} href={item.href} className="ein:contents">
                  {DockItemContent}
                </a>
              )
            }

            return <React.Fragment key={item.id}>{DockItemContent}</React.Fragment>
          })}
        </div>
      </div>
    )
  },
)
GlassDock.displayName = "GlassDock"

export { GlassDock }
export type { DockItem, DockOrientation }
