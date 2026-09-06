"use client"

import * as React from "react"
import { Label as LabelPrimitive } from "radix-ui"

import { cn } from "@/components/einui/utils"

function Label({
  className,
  ...props
}: React.ComponentProps<typeof LabelPrimitive.Root>) {
  return (
    <LabelPrimitive.Root
      data-slot="label"
      className={cn(
        "ein:flex ein:items-center ein:gap-2 ein:text-sm ein:leading-none ein:font-medium ein:select-none ein:group-data-[disabled=true]:pointer-events-none ein:group-data-[disabled=true]:opacity-50 ein:peer-disabled:cursor-not-allowed ein:peer-disabled:opacity-50",
        className
      )}
      {...props}
    />
  )
}

export { Label }
