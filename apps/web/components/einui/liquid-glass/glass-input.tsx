"use client"

import * as React from "react"
import { cn } from "@/components/einui/utils"

export interface GlassInputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  nativeLayout?: boolean
  glowOnFocus?: boolean
}

const GlassInput = React.forwardRef<HTMLInputElement, GlassInputProps>(
  ({ nativeLayout, className, type, glowOnFocus = true, ...props }, ref) => {
    if (nativeLayout) return <input ref={ref} type={type} data-ein-control="true" className={cn("ein-native-control", className)} {...props} />
    return (
      <div className="ein:relative ein:group">
        {glowOnFocus && (
          <div className="ein:absolute ein:-inset-0.5 ein:rounded-xl ein:bg-linear-to-r ein:from-cyan-500/0 ein:via-blue-500/0 ein:to-purple-500/0 ein:blur-md ein:opacity-0 ein:transition-all ein:duration-300 ein:group-focus-within:from-cyan-500/30 ein:group-focus-within:via-blue-500/30 ein:group-focus-within:to-purple-500/30 ein:group-focus-within:opacity-70" />
        )}
        <input
          type={type}
          className={cn(
            "ein:relative ein:flex ein:h-10 ein:w-full ein:rounded-xl ein:px-4 ein:py-2 ein:text-sm",
            "ein:bg-white/10 ein:backdrop-blur-xl ein:border ein:border-white/20",
            "ein:text-white ein:placeholder:text-white/70",
            "ein:shadow-[0_4px_16px_rgba(0,0,0,0.2)]",
            "ein:transition-all ein:duration-300",
            "ein:focus:outline-none ein:focus:border-white/40 ein:focus:bg-white/15",
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
