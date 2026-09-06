"use client"

import * as React from "react"
import * as TabsPrimitive from "@radix-ui/react-tabs"
import { motion, AnimatePresence } from "motion/react"
import { cn } from "@/components/einui/utils"

const GlassTabs = TabsPrimitive.Root

const GlassTabsList = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.List>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.List> & { animated?: boolean }
>(({ className, animated = true, ...props }, ref) => (
  <div className="ein:relative">
    {animated ? <motion.div
      className="ein:absolute ein:-inset-1 ein:rounded-2xl ein:bg-linear-to-r ein:from-cyan-500/20 ein:via-blue-500/20 ein:to-purple-500/20 ein:blur-lg"
      animate={{
        opacity: [0.4, 0.6, 0.4],
      }}
      transition={{
        duration: 3,
        repeat: Number.POSITIVE_INFINITY,
        ease: "easeInOut",
      }}
      aria-hidden="true"
    /> : <div aria-hidden="true" className="ein:absolute ein:-inset-1 ein:rounded-2xl ein:bg-linear-to-r ein:from-cyan-500/20 ein:via-blue-500/20 ein:to-purple-500/20 ein:blur-lg" />}
    <TabsPrimitive.List
      ref={ref}
      className={cn(
        "ein:relative ein:inline-flex ein:h-12 ein:items-center ein:justify-center ein:gap-1 ein:rounded-xl ein:p-1",
        "ein:bg-white/10 ein:backdrop-blur-xl ein:border ein:border-white/20",
        "ein:shadow-[0_4px_16px_rgba(0,0,0,0.2)]",
        className,
      )}
      aria-label="Tab navigation"
      {...props}
    />
  </div>
))
GlassTabsList.displayName = TabsPrimitive.List.displayName

const GlassTabsTrigger = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Trigger
    ref={ref}
    className={cn(
      "ein:relative ein:inline-flex ein:items-center ein:justify-center ein:whitespace-nowrap ein:rounded-lg ein:px-4 ein:py-2",
      "ein:text-sm ein:font-medium ein:text-white/60 ein:transition-colors ein:duration-200",
      "ein:focus-visible:outline-none ein:focus-visible:ring-2 ein:focus-visible:ring-white/50 ein:focus-visible:ring-offset-2 ein:focus-visible:ring-offset-transparent",
      "ein:disabled:pointer-events-none ein:disabled:opacity-50",
      "ein:hover:text-white/80 ein:hover:bg-white/5",
      "ein:data-[state=active]:bg-white/20 ein:data-[state=active]:text-white",
      "ein:data-[state=active]:shadow-[0_2px_8px_rgba(0,0,0,0.2)]",
      "ein:data-[state=active]:before:absolute ein:data-[state=active]:before:inset-0",
      "ein:data-[state=active]:before:rounded-lg ein:data-[state=active]:before:bg-linear-to-b",
      "ein:data-[state=active]:before:from-white/20 ein:data-[state=active]:before:to-transparent",
      "ein:data-[state=active]:before:pointer-events-none",
      className,
    )}
    {...props}
  />
))
GlassTabsTrigger.displayName = TabsPrimitive.Trigger.displayName

const GlassTabsContent = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Content> & { animated?: boolean }
>(({ className, children, animated = true, ...props }, ref) => (
  <TabsPrimitive.Content
    ref={ref}
    className={cn("ein:mt-4 ein:focus-visible:outline-none ein:focus-visible:ring-2 ein:focus-visible:ring-white/50", className)}
    {...props}
  >
    {animated ? <AnimatePresence mode="wait">
      <motion.div
        key={props.value}
        initial={{ opacity: 0, y: 10 }}
        animate={{
          opacity: 1,
          y: 0,
          transition: {
            type: "spring",
            visualDuration: 0.3,
            bounce: 0.2,
          },
        }}
        exit={{
          opacity: 0,
          y: -10,
          transition: { duration: 0.15 },
        }}
      >
        {children}
      </motion.div>
    </AnimatePresence> : children}
  </TabsPrimitive.Content>
))
GlassTabsContent.displayName = TabsPrimitive.Content.displayName

export { GlassTabs, GlassTabsList, GlassTabsTrigger, GlassTabsContent }
