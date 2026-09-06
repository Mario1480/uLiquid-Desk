"use client"

import { Slot } from "radix-ui"
import * as React from "react"
import { cn } from "@/components/einui/utils"

interface GlassCardProps extends React.HTMLAttributes<HTMLDivElement> {
  asChild?: boolean
  glowEffect?: boolean
  children: React.ReactNode
}

const GlassCard = React.forwardRef<HTMLDivElement, GlassCardProps>(
  ({ className, asChild = false, glowEffect = true, children, ...props }, ref) => {
    // Slot mode preserves layout and semantic elements in the marketing site.
    if (asChild) return <Slot.Root ref={ref} data-ein-surface="true" className={cn(
      "ein-card-material ein:relative ein:rounded-2xl ein:backdrop-blur-xl",
      className,
    )} {...props}>{children}</Slot.Root>

    return (
      <div className="ein:relative">
        {glowEffect && (
          <div className="ein:absolute ein:-inset-1 ein:rounded-2xl ein:bg-linear-to-r ein:from-cyan-500/30 ein:via-blue-500/30 ein:to-purple-500/30 ein:blur-xl ein:opacity-70" />
        )}
        <div
          ref={ref}
          className={cn(
            "ein-card-material ein:relative ein:rounded-2xl ein:backdrop-blur-xl",
            className,
          )}
          {...props}
        >
          <div className="ein:relative ein:z-10">{children}</div>
        </div>
      </div>
    )
  },
)
GlassCard.displayName = "GlassCard"

const GlassCardHeader = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => <div ref={ref} className={cn("ein:flex ein:flex-col ein:gap-1.5 ein:p-6", className)} {...props} />,
)
GlassCardHeader.displayName = "GlassCardHeader"

const GlassCardTitle = React.forwardRef<HTMLHeadingElement, React.HTMLAttributes<HTMLHeadingElement>>(
  ({ className, ...props }, ref) => (
    <h3
      ref={ref}
      className={cn("ein:text-xl ein:font-semibold ein:text-white ein:leading-none ein:tracking-tight", className)}
      {...props}
    />
  ),
)
GlassCardTitle.displayName = "GlassCardTitle"

const GlassCardDescription = React.forwardRef<HTMLParagraphElement, React.HTMLAttributes<HTMLParagraphElement>>(
  ({ className, ...props }, ref) => <p ref={ref} className={cn("ein:text-sm ein:text-white/60", className)} {...props} />,
)
GlassCardDescription.displayName = "GlassCardDescription"

const GlassCardContent = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => <div ref={ref} className={cn("ein:p-6 ein:pt-0", className)} {...props} />,
)
GlassCardContent.displayName = "GlassCardContent"

const GlassCardFooter = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn("ein:flex ein:items-center ein:p-6 ein:pt-0", className)} {...props} />
  ),
)
GlassCardFooter.displayName = "GlassCardFooter"

export { GlassCard, GlassCardHeader, GlassCardTitle, GlassCardDescription, GlassCardContent, GlassCardFooter }
