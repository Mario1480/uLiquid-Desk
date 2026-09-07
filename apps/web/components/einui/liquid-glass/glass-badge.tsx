"use client"

import type * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/components/einui/utils"

const glassBadgeVariants = cva(
  cn(
    "ein:inline-flex ein:items-center ein:rounded-full ein:px-3 ein:py-1 ein:text-xs ein:font-medium",
    "ein:backdrop-blur-xl ein:border ein:transition-all ein:duration-300",
  ),
  {
    variants: {
      variant: {
        default: "ein:bg-white/15 ein:border-white/25 ein:text-white",
        primary: cn("ein:bg-blue-500/20", "ein:border-cyan-400/30 ein:text-cyan-100"),
        success: cn("ein:bg-emerald-500/20 ein:border-emerald-400/30 ein:text-emerald-100"),
        warning: cn("ein:bg-amber-500/20 ein:border-amber-400/30 ein:text-amber-100"),
        destructive: cn("ein:bg-red-500/20 ein:border-red-400/30 ein:text-red-100"),
        outline: "ein:bg-transparent ein:border-white/30 ein:text-white/80",
      },
      size: {
        sm: "ein:px-2 ein:py-0.5 ein:text-xs",
        md: "ein:px-3 ein:py-1 ein:text-sm",
        lg: "ein:px-4 ein:py-2 ein:text-base",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "md",
    },
  },
)

export interface GlassBadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof glassBadgeVariants> { nativeLayout?: boolean; ref?: React.Ref<HTMLSpanElement> }

function GlassBadge({ nativeLayout, className, variant, size, ...props }: GlassBadgeProps) {
  return <span data-ein-badge="true" data-ein-badge-tone={variant || "default"} className={cn(nativeLayout ? "ein-native-badge" : glassBadgeVariants({ variant, size }), className)} {...props} />
}

export { GlassBadge, glassBadgeVariants }
