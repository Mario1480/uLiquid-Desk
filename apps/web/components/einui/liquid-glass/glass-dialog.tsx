"use client"

import * as React from "react"
import { EinPortalTheme } from "../portal-theme"
import { Dialog as DialogPrimitive } from "radix-ui"
import { X } from "lucide-react"
import { cn } from "@/components/einui/utils"

const GlassDialog = DialogPrimitive.Root

const GlassDialogTrigger = DialogPrimitive.Trigger

const GlassDialogPortal = ({children, ...props}: React.ComponentPropsWithoutRef<typeof DialogPrimitive.Portal>) => <DialogPrimitive.Portal {...props}><EinPortalTheme>{children}</EinPortalTheme></DialogPrimitive.Portal>

const GlassDialogClose = DialogPrimitive.Close

const GlassDialogOverlay = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay
    ref={ref}
    className={cn(
      "ein:fixed ein:inset-0 ein:z-50 ein:bg-black/60 ein:backdrop-blur-sm",
      "ein:data-[state=open]:animate-in ein:data-[state=closed]:animate-out",
      "ein:data-[state=closed]:fade-out-0 ein:data-[state=open]:fade-in-0",
      className,
    )}
    {...props}
  />
))
GlassDialogOverlay.displayName = DialogPrimitive.Overlay.displayName

const GlassDialogContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content>
>(({ className, children, ...props }, ref) => (
  <GlassDialogPortal>
    <GlassDialogOverlay />
    <DialogPrimitive.Content
      data-ein-overlay="true"
      ref={ref}
      className={cn(
        "ein:fixed ein:left-1/2 ein:top-1/2 ein:z-50 ein:w-[calc(100%-2rem)] ein:max-w-lg ein:-translate-x-1/2 ein:-translate-y-1/2",
        "ein:rounded-2xl ein:border ein:border-white/20 ein:p-6",
        "",
        "",
        "ein:before:absolute ein:before:inset-0 ein:before:rounded-2xl",
        "ein:before:bg-linear-to-b ein:before:from-white/15 ein:before:to-transparent ein:before:pointer-events-none",
        "ein:data-[state=open]:animate-in ein:data-[state=closed]:animate-out",
        "ein:data-[state=closed]:fade-out-0 ein:data-[state=open]:fade-in-0",
        " ",
        " ",
        " ",
        className,
      )}
      {...props}
    >
      <div className="ein:relative ein:z-10">{children}</div>
      <DialogPrimitive.Close className="ein:absolute ein:right-4 ein:top-4 ein:rounded-lg ein:p-1 ein:text-white/60 ein:transition-all ein:hover:text-white ein:hover:bg-white/10 ein:focus:outline-none ein:focus:ring-2 ein:focus:ring-white/50">
        <X className="ein:h-4 ein:w-4" />
        <span className="ein:sr-only">Close</span>
      </DialogPrimitive.Close>
    </DialogPrimitive.Content>
  </GlassDialogPortal>
))
GlassDialogContent.displayName = DialogPrimitive.Content.displayName

const GlassDialogHeader = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn("ein:flex ein:flex-col ein:gap-1.5 ein:text-center ein:sm:text-left", className)} {...props} />
)
GlassDialogHeader.displayName = "GlassDialogHeader"

const GlassDialogFooter = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn("ein:flex ein:flex-col-reverse ein:sm:flex-row ein:sm:justify-end ein:gap-2 ein:mt-6", className)} {...props} />
)
GlassDialogFooter.displayName = "GlassDialogFooter"

const GlassDialogTitle = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title
    ref={ref}
    className={cn("ein:text-lg ein:font-semibold ein:text-white ein:leading-none ein:tracking-tight", className)}
    {...props}
  />
))
GlassDialogTitle.displayName = DialogPrimitive.Title.displayName

const GlassDialogDescription = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Description ref={ref} className={cn("ein:text-sm ein:text-white/60", className)} {...props} />
))
GlassDialogDescription.displayName = DialogPrimitive.Description.displayName

export {
  GlassDialog,
  GlassDialogPortal,
  GlassDialogOverlay,
  GlassDialogClose,
  GlassDialogTrigger,
  GlassDialogContent,
  GlassDialogHeader,
  GlassDialogFooter,
  GlassDialogTitle,
  GlassDialogDescription,
}
