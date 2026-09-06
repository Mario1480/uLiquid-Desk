"use client"

import * as React from "react"
import { X, ChevronLeft, ChevronRight } from "lucide-react"
import { Dialog } from "radix-ui"
import { EinPortalTheme } from "../portal-theme"
import { cn } from "@/components/einui/utils"

interface SpotlightStep {
  target: string // CSS selector
  title: string
  description: string
  placement?: "top" | "bottom" | "left" | "right"
}

interface GlassSpotlightProps {
  steps: SpotlightStep[]
  open?: boolean
  onOpenChange?: (open: boolean) => void
  onComplete?: () => void
}

function GlassSpotlight({ steps, open = false, onOpenChange, onComplete }: GlassSpotlightProps) {
  const maskId = React.useId()
  const returnFocus = React.useRef<HTMLElement | null>(null)
  const [currentStep, setCurrentStep] = React.useState(0)
  const [targetRect, setTargetRect] = React.useState<DOMRect | null>(null)

  const step = steps[currentStep]

  React.useLayoutEffect(() => {
    if (!open || !step) return

    const target = document.querySelector(step.target)
    if (target) {
      const rect = target.getBoundingClientRect()
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setTargetRect(rect)
      target.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "center" })
    }
  }, [open, step, currentStep])

  React.useEffect(() => {
    const handleResize = () => {
      if (!step) return
      const target = document.querySelector(step.target)
      if (target) {
        setTargetRect(target.getBoundingClientRect())
      }
    }

    window.addEventListener("resize", handleResize)
    window.addEventListener("scroll", handleResize, true)
    return () => { window.removeEventListener("resize", handleResize); window.removeEventListener("scroll", handleResize, true) }
  }, [step])

  const handleNext = () => {
    if (currentStep < steps.length - 1) {
      setCurrentStep((prev) => prev + 1)
    } else {
      onComplete?.()
      onOpenChange?.(false)
      setCurrentStep(0)
    }
  }

  const handlePrev = () => {
    if (currentStep > 0) {
      setCurrentStep((prev) => prev - 1)
    }
  }

  const handleClose = () => {
    onOpenChange?.(false)
    setCurrentStep(0)
  }

  if (!open || !targetRect) return null

  const padding = 8
  const tooltipWidth = Math.min(320, window.innerWidth - 32)

  // Calculate tooltip position
  let tooltipStyle: React.CSSProperties = {}
  const placement = step.placement || "bottom"

  switch (placement) {
    case "top":
      tooltipStyle = {
        left: targetRect.left + targetRect.width / 2 - tooltipWidth / 2,
        bottom: window.innerHeight - targetRect.top + padding + 12,
      }
      break
    case "bottom":
      tooltipStyle = {
        left: targetRect.left + targetRect.width / 2 - tooltipWidth / 2,
        top: targetRect.bottom + padding + 12,
      }
      break
    case "left":
      tooltipStyle = {
        right: window.innerWidth - targetRect.left + padding + 12,
        top: targetRect.top + targetRect.height / 2 - 60,
      }
      break
    case "right":
      tooltipStyle = {
        left: targetRect.right + padding + 12,
        top: targetRect.top + targetRect.height / 2 - 60,
      }
      break
  }

  tooltipStyle.left = Math.max(16, Math.min(Number(tooltipStyle.left || 16), window.innerWidth - tooltipWidth - 16))
  return (
    <Dialog.Root open={open} onOpenChange={next=>{if(!next)handleClose()}}><Dialog.Portal><EinPortalTheme><div className="ein:fixed ein:inset-0 ein:z-50">
      {/* Overlay with cutout */}
      <svg className="ein:absolute ein:inset-0 ein:w-full ein:h-full">
        <defs>
          <mask id={maskId}>
            <rect x="0" y="0" width="100%" height="100%" fill="white" />
            <rect
              x={targetRect.left - padding}
              y={targetRect.top - padding}
              width={targetRect.width + padding * 2}
              height={targetRect.height + padding * 2}
              rx="12"
              fill="black"
            />
          </mask>
        </defs>
        <rect x="0" y="0" width="100%" height="100%" fill="rgba(0,0,0,0.75)" mask={`url(#${maskId})`} />
      </svg>

      {/* Spotlight border */}
      <div
        className="ein:absolute ein:rounded-xl ein:pointer-events-none ein:animate-pulse"
        style={{
          left: targetRect.left - padding,
          top: targetRect.top - padding,
          width: targetRect.width + padding * 2,
          height: targetRect.height + padding * 2,
          boxShadow: "0 0 0 2px rgba(6, 182, 212, 0.5), 0 0 20px rgba(6, 182, 212, 0.3)",
        }}
      />

      {/* Tooltip */}
      <Dialog.Content asChild onOpenAutoFocus={()=>{if(document.activeElement instanceof HTMLElement)returnFocus.current=document.activeElement}} onCloseAutoFocus={event=>{event.preventDefault();returnFocus.current?.focus()}}><div
        className="ein:fixed ein:z-50"
        style={{
          ...tooltipStyle,
          width: tooltipWidth,
        }}
      >
        <div className="ein:relative">
          {/* Glow */}
          <div className="ein:absolute ein:-inset-2 ein:rounded-xl ein:bg-linear-to-r ein:from-cyan-500/30 ein:to-blue-500/30 ein:blur-lg ein:opacity-70" />

          {/* Card */}
          <div className="ein:relative ein:rounded-xl ein:border ein:border-white/20 ein:bg-black/90 ein:backdrop-blur-xl ein:p-4 ein:shadow-[0_8px_32px_rgba(0,0,0,0.4)]">
            {/* Glass highlight */}
            <div className="ein:absolute ein:inset-0 ein:rounded-xl ein:bg-linear-to-b ein:from-white/10 ein:to-transparent ein:pointer-events-none" />

            <div className="ein:relative">
              {/* Header */}
              <div className="ein:flex ein:items-center ein:justify-between ein:mb-2">
                <span className="ein:text-xs ein:text-white/70">
                  Step {currentStep + 1} of {steps.length}
                </span>
                <button
                  aria-label="Close tour" onClick={handleClose}
                  className="ein:p-1 ein:rounded-lg ein:text-white/70 ein:hover:text-white ein:hover:bg-white/10 ein:transition-colors"
                >
                  <X className="ein:w-4 ein:h-4" />
                </button>
              </div>

              {/* Content */}
              <Dialog.Title asChild><h4 className="ein:font-semibold ein:text-white ein:mb-2">{step.title}</h4></Dialog.Title>
              <Dialog.Description asChild><p className="ein:text-sm ein:text-white/60 ein:mb-4">{step.description}</p></Dialog.Description>

              {/* Navigation */}
              <div className="ein:flex ein:items-center ein:justify-between">
                <button
                  onClick={handlePrev}
                  disabled={currentStep === 0}
                  className={cn(
                    "ein:flex ein:items-center ein:gap-1 ein:px-3 ein:py-1.5 ein:rounded-lg ein:text-sm",
                    "ein:transition-colors",
                    currentStep === 0
                      ? "ein:text-white/20 ein:cursor-not-allowed"
                      : "ein:text-white/60 ein:hover:text-white ein:hover:bg-white/10",
                  )}
                >
                  <ChevronLeft className="ein:w-4 ein:h-4" />
                  Back
                </button>

                <button
                  onClick={handleNext}
                  className={cn(
                    "ein:flex ein:items-center ein:gap-1 ein:px-4 ein:py-1.5 ein:rounded-lg ein:text-sm ein:font-medium",
                    "ein:bg-linear-to-r ein:from-cyan-500 ein:to-blue-500 ein:text-white",
                    "ein:hover:from-cyan-400 ein:hover:to-blue-400 ein:transition-all",
                  )}
                >
                  {currentStep === steps.length - 1 ? "Finish" : "Next"}
                  {currentStep < steps.length - 1 && <ChevronRight className="ein:w-4 ein:h-4" />}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div></Dialog.Content>
    </div></EinPortalTheme></Dialog.Portal></Dialog.Root>
  )
}

export { GlassSpotlight }
export type { SpotlightStep }
