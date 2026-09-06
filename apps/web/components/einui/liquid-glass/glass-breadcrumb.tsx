"use client"

import { Slot } from "radix-ui"
import * as React from "react"
import { ChevronRight, MoreHorizontal } from "lucide-react"
import { cn } from "@/components/einui/utils"

const GlassBreadcrumb = React.forwardRef<
  HTMLElement,
  React.ComponentPropsWithoutRef<"nav"> & {
    separator?: React.ReactNode
  }
>(({ ...props }, ref) => <nav ref={ref} aria-label="breadcrumb" {...props} />)
GlassBreadcrumb.displayName = "GlassBreadcrumb"

const GlassBreadcrumbList = React.forwardRef<HTMLOListElement, React.ComponentPropsWithoutRef<"ol">>(
  ({ className, ...props }, ref) => (
    <ol
      ref={ref}
      className={cn(
        "ein:flex ein:flex-wrap ein:items-center ein:gap-1.5 ein:wrap-break-word ein:text-sm",
        "ein:px-4 ein:py-2 ein:rounded-xl",
        "ein:bg-white/5 ein:backdrop-blur-xl ein:border ein:border-white/10",
        className,
      )}
      {...props}
    />
  ),
)
GlassBreadcrumbList.displayName = "GlassBreadcrumbList"

const GlassBreadcrumbItem = React.forwardRef<HTMLLIElement, React.ComponentPropsWithoutRef<"li">>(
  ({ className, ...props }, ref) => (
    <li ref={ref} className={cn("ein:inline-flex ein:items-center ein:gap-1.5", className)} {...props} />
  ),
)
GlassBreadcrumbItem.displayName = "GlassBreadcrumbItem"

const GlassBreadcrumbLink = React.forwardRef<
  HTMLAnchorElement,
  React.ComponentPropsWithoutRef<"a"> & {
    asChild?: boolean
  }
>(({ asChild, className, ...props }, ref) => {
  const Comp = asChild ? Slot.Root : "a"
  return (
    <Comp
      ref={ref}
      className={cn(
        "ein:text-white/60 ein:transition-colors ein:duration-200",
        "ein:hover:text-white ein:hover:underline ein:underline-offset-4",
        "ein:focus:outline-none ein:focus:text-white",
        className,
      )}
      {...props}
    />
  )
})
GlassBreadcrumbLink.displayName = "GlassBreadcrumbLink"

const GlassBreadcrumbPage = React.forwardRef<HTMLSpanElement, React.ComponentPropsWithoutRef<"span">>(
  ({ className, ...props }, ref) => (
    <span
      ref={ref}
      role="link"
      aria-disabled="true"
      aria-current="page"
      className={cn("ein:font-medium ein:text-white", className)}
      {...props}
    />
  ),
)
GlassBreadcrumbPage.displayName = "GlassBreadcrumbPage"

const GlassBreadcrumbSeparator = ({ children, className, ...props }: React.ComponentProps<"li">) => (
  <li role="presentation" aria-hidden="true" className={cn("ein:[&>svg]:size-3.5 ein:text-white/70", className)} {...props}>
    {children ?? <ChevronRight />}
  </li>
)
GlassBreadcrumbSeparator.displayName = "GlassBreadcrumbSeparator"

const GlassBreadcrumbEllipsis = ({ className, ...props }: React.ComponentProps<"span">) => (
  <span
    role="presentation"
    aria-hidden="true"
    className={cn(
      "ein:flex ein:h-8 ein:w-8 ein:items-center ein:justify-center ein:rounded-lg",
      "ein:bg-white/5 ein:hover:bg-white/10 ein:transition-colors",
      "ein:text-white/60",
      className,
    )}
    {...props}
  >
    <MoreHorizontal className="ein:h-4 ein:w-4" />
    <span className="ein:sr-only">More</span>
  </span>
)
GlassBreadcrumbEllipsis.displayName = "GlassBreadcrumbEllipsis"

export {
  GlassBreadcrumb,
  GlassBreadcrumbList,
  GlassBreadcrumbItem,
  GlassBreadcrumbLink,
  GlassBreadcrumbPage,
  GlassBreadcrumbSeparator,
  GlassBreadcrumbEllipsis,
}
