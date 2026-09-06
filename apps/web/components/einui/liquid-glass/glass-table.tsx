"use client"

import * as React from "react"
import { cn } from "@/components/einui/utils"

const GlassTable = React.forwardRef<HTMLTableElement, React.HTMLAttributes<HTMLTableElement> & { nativeLayout?: boolean }>(
  ({ nativeLayout, className, ...props }, ref) => nativeLayout ? <table ref={ref} data-ein-table="true" className={className} {...props} /> : (
    <div className="ein:relative ein:w-full ein:overflow-auto ein:rounded-2xl ein:border ein:border-white/20 ein:bg-white/5 ein:backdrop-blur-xl ein:shadow-[0_8px_32px_rgba(0,0,0,0.2)]">
      <table ref={ref} className={cn("ein:w-full ein:caption-bottom ein:text-sm", className)} {...props} />
    </div>
  ),
)
GlassTable.displayName = "GlassTable"

const GlassTableHeader = React.forwardRef<HTMLTableSectionElement, React.HTMLAttributes<HTMLTableSectionElement>>(
  ({ className, ...props }, ref) => (
    <thead ref={ref} className={cn("ein:[&_tr]:border-b ein:border-white/10", className)} {...props} />
  ),
)
GlassTableHeader.displayName = "GlassTableHeader"

const GlassTableBody = React.forwardRef<HTMLTableSectionElement, React.HTMLAttributes<HTMLTableSectionElement>>(
  ({ className, ...props }, ref) => (
    <tbody ref={ref} className={cn("ein:[&_tr:last-child]:border-0", className)} {...props} />
  ),
)
GlassTableBody.displayName = "GlassTableBody"

const GlassTableFooter = React.forwardRef<HTMLTableSectionElement, React.HTMLAttributes<HTMLTableSectionElement>>(
  ({ className, ...props }, ref) => (
    <tfoot
      ref={ref}
      className={cn("ein:border-t ein:border-white/10 ein:bg-white/5 ein:font-medium ein:[&>tr]:last:border-b-0", className)}
      {...props}
    />
  ),
)
GlassTableFooter.displayName = "GlassTableFooter"

const GlassTableRow = React.forwardRef<HTMLTableRowElement, React.HTMLAttributes<HTMLTableRowElement>>(
  ({ className, ...props }, ref) => (
    <tr
      ref={ref}
      className={cn(
        "ein:border-b ein:border-white/10 ein:transition-colors",
        "ein:hover:bg-white/5 ein:data-[state=selected]:bg-white/10",
        className,
      )}
      {...props}
    />
  ),
)
GlassTableRow.displayName = "GlassTableRow"

const GlassTableHead = React.forwardRef<HTMLTableCellElement, React.ThHTMLAttributes<HTMLTableCellElement>>(
  ({ className, ...props }, ref) => (
    <th
      ref={ref}
      className={cn(
        "ein:h-12 ein:px-4 ein:text-left ein:align-middle ein:font-medium ein:text-white/60",
        "ein:has-[[role=checkbox]]:pr-0",
        className,
      )}
      {...props}
    />
  ),
)
GlassTableHead.displayName = "GlassTableHead"

const GlassTableCell = React.forwardRef<HTMLTableCellElement, React.TdHTMLAttributes<HTMLTableCellElement>>(
  ({ className, ...props }, ref) => (
    <td
      ref={ref}
      className={cn("ein:p-4 ein:align-middle ein:text-white/80 ein:has-[[role=checkbox]]:pr-0", className)}
      {...props}
    />
  ),
)
GlassTableCell.displayName = "GlassTableCell"

const GlassTableCaption = React.forwardRef<HTMLTableCaptionElement, React.HTMLAttributes<HTMLTableCaptionElement>>(
  ({ className, ...props }, ref) => (
    <caption ref={ref} className={cn("ein:mt-4 ein:text-sm ein:text-white/70", className)} {...props} />
  ),
)
GlassTableCaption.displayName = "GlassTableCaption"

export {
  GlassTable,
  GlassTableHeader,
  GlassTableBody,
  GlassTableFooter,
  GlassTableHead,
  GlassTableRow,
  GlassTableCell,
  GlassTableCaption,
}
