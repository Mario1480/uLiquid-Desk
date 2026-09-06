"use client"

import * as React from "react"
import { motion } from "motion/react"
import { cn } from "@/components/einui/utils"

export interface GlassTextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  nativeLayout?: boolean
  glowOnFocus?: boolean
  label?: string
  error?: string
}

const GlassTextarea = React.forwardRef<HTMLTextAreaElement, GlassTextareaProps>(
  ({ nativeLayout, className, glowOnFocus = false, label, error, id, ...props }, ref) => {
    const generatedId = React.useId()
    const textareaId = id || generatedId
    const errorId = `${textareaId}-error`

    if (nativeLayout) return <textarea ref={ref} id={id} data-ein-control="true" className={cn("ein-native-control", className)} {...props} />
    return (
      <div className="ein:relative ein:w-full">
        {label && (
          <motion.label
            htmlFor={textareaId}
            className="ein:block ein:text-sm ein:font-medium ein:text-white/80 ein:mb-2"
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.2 }}
          >
            {label}
          </motion.label>
        )}
        <motion.div
          className="ein:relative ein:group"
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ type: "spring", visualDuration: 0.3, bounce: 0.2 }}
        >
          {glowOnFocus && (
            <motion.div
              className="ein-control-glow"
              aria-hidden="true"
            />
          )}
          <textarea
            data-ein-control="true"
            id={textareaId}
            className={cn(
              "ein:relative ein:flex ein:min-h-30 ein:w-full ein:rounded-xl ein:px-4 ein:py-3 ein:text-sm",
              "ein:text-white ein:placeholder:text-white/70",
              "ein:transition-all ein:duration-300 ein:resize-none",
              "ein:focus:ring-2 ein:focus:ring-cyan-400/30 ein:focus:ring-offset-0",
              "ein:disabled:cursor-not-allowed ein:disabled:opacity-50",
              error && "ein:border-red-400/50 ein:focus:border-red-400/70 ein:focus:ring-red-400/30",
              className,
            )}
            ref={ref}
            aria-invalid={error ? "true" : undefined}
            aria-describedby={error ? errorId : undefined}
            {...props}
          />
        </motion.div>
        {error && (
          <motion.p
            id={errorId}
            className="ein:mt-2 ein:text-sm ein:text-red-400"
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.2 }}
            role="alert"
          >
            {error}
          </motion.p>
        )}
      </div>
    )
  },
)
GlassTextarea.displayName = "GlassTextarea"

export { GlassTextarea }
