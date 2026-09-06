"use client"

import * as React from "react"
import { Check } from "lucide-react"
import { cn } from "@/components/einui/utils"

interface TimelineItem {
  id: string
  title: string
  description?: React.ReactNode
  date?: string
  icon?: React.ReactNode
  status?: "completed" | "current" | "upcoming"
}

interface GlassTimelineProps extends React.HTMLAttributes<HTMLDivElement> {
  items: TimelineItem[]
  orientation?: "vertical" | "horizontal"
}

const GlassTimeline = React.forwardRef<HTMLDivElement, GlassTimelineProps>(
  ({ className, items, orientation = "vertical", ...props }, ref) => {
    if (orientation === "horizontal") {
      return (
        <div ref={ref} className={cn("ein:w-full ein:overflow-x-auto", className)} {...props}>
          <div className="ein:flex ein:items-start ein:gap-4 ein:min-w-max ein:px-4">
            {items.map((item, index) => (
              <div id={item.id} key={item.id} className="ein:flex ein:flex-col ein:items-center">
                <div className="ein:flex ein:items-center">
                  {/* Node */}
                  <GlassTimelineNode status={item.status} icon={item.icon} />

                  {/* Connector */}
                  {index < items.length - 1 && (
                    <div
                      className={cn(
                        "ein:w-24 ein:h-0.5 ein:mx-2",
                        item.status === "completed" ? "ein:bg-linear-to-r ein:from-cyan-500 ein:to-blue-500" : "ein:bg-white/20",
                      )}
                    />
                  )}
                </div>

                {/* Content */}
                <div className="ein:mt-4 ein:text-center ein:max-w-37.5">
                  <h3 className="ein:font-medium ein:text-white ein:text-sm">{item.title}</h3>
                  {item.date && <p className="ein:text-xs ein:text-white/70 ein:mt-1">{item.date}</p>}
                  {item.description && <p className="ein:text-xs ein:text-white/60 ein:mt-2">{item.description}</p>}
                </div>
              </div>
            ))}
          </div>
        </div>
      )
    }

    return (
      <div ref={ref} className={cn("ein:relative", className)} {...props}>
        {items.map((item, index) => (
          <div id={item.id} key={item.id} className="ein:flex ein:gap-4 ein:pb-8 ein:last:pb-0">
            {/* Node and line */}
            <div className="ein:flex ein:flex-col ein:items-center">
              <GlassTimelineNode status={item.status} icon={item.icon} />
              {index < items.length - 1 && (
                <div
                  className={cn(
                    "ein:w-0.5 ein:flex-1 ein:mt-2",
                    item.status === "completed" ? "ein:bg-linear-to-b ein:from-cyan-500 ein:to-blue-500" : "ein:bg-white/20",
                  )}
                />
              )}
            </div>

            {/* Content card */}
            <div className="ein:flex-1 ein:pb-2">
              <GlassTimelineCard item={item} />
            </div>
          </div>
        ))}
      </div>
    )
  },
)
GlassTimeline.displayName = "GlassTimeline"

function GlassTimelineNode({ status, icon }: { status?: TimelineItem["status"]; icon?: React.ReactNode }) {
  return (
    <div className="ein:relative">
      {/* Glow for current */}
      {status === "current" && (
        <div className="ein:absolute ein:-inset-2 ein:rounded-full ein:bg-linear-to-r ein:from-cyan-500/50 ein:to-blue-500/50 ein:blur-md ein:animate-pulse" />
      )}

      <div
        className={cn(
          "ein:relative ein:w-10 ein:h-10 ein:rounded-full ein:flex ein:items-center ein:justify-center",
          "ein:border-2 ein:transition-all ein:duration-300",
          status === "completed" && "ein:bg-linear-to-br ein:from-cyan-500 ein:to-blue-500 ein:border-cyan-400/50",
          status === "current" && "ein:bg-white/20 ein:backdrop-blur-xl ein:border-cyan-400/50",
          status === "upcoming" && "ein:bg-white/5 ein:backdrop-blur-xl ein:border-white/20",
          !status && "ein:bg-white/10 ein:backdrop-blur-xl ein:border-white/20",
        )}
      >
        {status === "completed" ? (
          <Check className="ein:w-5 ein:h-5 ein:text-white" />
        ) : icon ? (
          <span className={cn("ein:text-white/80", status === "current" && "ein:text-cyan-400")}>{icon}</span>
        ) : (
          <div className={cn("ein:w-3 ein:h-3 ein:rounded-full", status === "current" ? "ein:bg-cyan-400" : "ein:bg-white/40")} />
        )}
      </div>
    </div>
  )
}

function GlassTimelineCard({ item }: { item: TimelineItem }) {
  const isCurrent = item.status === "current"

  return (
    <div className="ein:relative">
      {isCurrent && (
        <div className="ein:absolute ein:-inset-1 ein:rounded-xl ein:bg-linear-to-r ein:from-cyan-500/30 ein:to-blue-500/30 ein:blur-lg ein:opacity-70" />
      )}

      <div
        className={cn(
          "ein:relative ein:rounded-xl ein:border ein:p-4",
          "ein:backdrop-blur-xl ein:transition-all ein:duration-300",
          isCurrent ? "ein:bg-white/15 ein:border-white/30" : "ein:bg-white/5 ein:border-white/10 ein:hover:bg-white/10",
        )}
      >
        <div className="ein:flex ein:items-start ein:justify-between ein:gap-2">
          <h3 className="ein:font-medium ein:text-white">{item.title}</h3>
          {item.date && <span className="ein:text-xs ein:text-white/70 ein:shrink-0">{item.date}</span>}
        </div>
        {item.description && <p className="ein:mt-2 ein:text-sm ein:text-white/60">{item.description}</p>}
      </div>
    </div>
  )
}

export { GlassTimeline }
export type { TimelineItem }
