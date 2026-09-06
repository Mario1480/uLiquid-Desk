"use client"

import * as React from "react"
import { cn } from "@/components/einui/utils"

export interface GlassInputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  nativeLayout?: boolean
  glowOnFocus?: boolean
}

const GlassInput = React.forwardRef<HTMLInputElement, GlassInputProps>(
  ({ nativeLayout, className, type, glowOnFocus = false, ...props }, ref) => {
    if (nativeLayout) return <input ref={ref} type={type} data-ein-control="true" className={cn("ein-native-control", className)} {...props} />
    return (
      <div className="ein:relative ein:group">
        {glowOnFocus && (
          <div className="ein-control-glow" />
        )}
        <input
            data-ein-control="true"
          type={type}
          className={cn(
            "ein:relative ein:flex ein:h-10 ein:w-full ein:rounded-xl ein:px-4 ein:py-2 ein:text-sm",
            "ein:text-white ein:placeholder:text-white/70",
            "ein:transition-all ein:duration-300",
            "ein:disabled:cursor-not-allowed ein:disabled:opacity-50",
            "ein:file:border-0 ein:file:bg-transparent ein:file:text-sm ein:file:font-medium ein:file:text-white",
            className,
          )}
          ref={ref}
          {...props}
        />
      </div>
    )
  },
)
GlassInput.displayName = "GlassInput"

export { GlassInput }
