"use client"

import * as React from "react"
import { EinPortalTheme } from "../portal-theme"
import * as AlertDialogPrimitive from "@radix-ui/react-alert-dialog"
import { cn } from "@/components/einui/utils"
import { glassButtonVariants } from "./glass-button"

const GlassAlertDialog = AlertDialogPrimitive.Root

const GlassAlertDialogTrigger = AlertDialogPrimitive.Trigger

const GlassAlertDialogPortal = ({children, ...props}: React.ComponentPropsWithoutRef<typeof AlertDialogPrimitive.Portal>) => <AlertDialogPrimitive.Portal {...props}><EinPortalTheme>{children}</EinPortalTheme></AlertDialogPrimitive.Portal>

const GlassAlertDialogOverlay = React.forwardRef<
  React.ElementRef<typeof AlertDialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof AlertDialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <AlertDialogPrimitive.Overlay
    className={cn(
      "ein:fixed ein:inset-0 ein:z-50 ein:bg-black/60 ein:backdrop-blur-sm",
      "ein:data-[state=open]:animate-in ein:data-[state=closed]:animate-out",
      "ein:data-[state=closed]:fade-out-0 ein:data-[state=open]:fade-in-0",
      className,
    )}
    {...props}
    ref={ref}
  />
))
GlassAlertDialogOverlay.displayName = AlertDialogPrimitive.Overlay.displayName


const GlassAlertDialogContent = React.forwardRef<
  React.ElementRef<typeof AlertDialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof AlertDialogPrimitive.Content>
>(({ className, ...props }, ref) => (
  <GlassAlertDialogPortal>
    <GlassAlertDialogOverlay />
    <AlertDialogPrimitive.Content
      ref={ref}
      className={cn(
        "ein:fixed ein:left-1/2 ein:top-1/2 ein:z-50 ein:w-full ein:max-w-sm ein:-translate-x-1/2 ein:-translate-y-1/2",
        "ein:rounded-2xl ein:border ein:border-white/20 ein:p-6",
        "ein:bg-white/10 ein:backdrop-blur-2xl",
        "ein:shadow-[0_8px_32px_rgba(0,0,0,0.4)]",
        "ein:data-[state=open]:animate-in ein:data-[state=closed]:animate-out",
        "ein:data-[state=closed]:fade-out-0 ein:data-[state=open]:fade-in-0",
        " ",
        " ",
        " ",
        // Glass highlight
        "ein:before:absolute ein:before:inset-0 ein:before:rounded-2xl",
        "ein:before:bg-linear-to-b ein:before:from-white/15 ein:before:to-transparent ein:before:pointer-events-none",
        className,
      )}
      {...props}
    />
  </GlassAlertDialogPortal>
))
GlassAlertDialogContent.displayName = AlertDialogPrimitive.Content.displayName

const GlassAlertDialogHeader = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn("ein:relative ein:z-10 ein:flex ein:flex-col ein:gap-2 ein:text-center ein:sm:text-left", className)} {...props} />
)
GlassAlertDialogHeader.displayName = "GlassAlertDialogHeader"

const GlassAlertDialogFooter = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn("ein:relative ein:z-10 ein:flex ein:flex-col-reverse ein:sm:flex-row ein:sm:justify-end ein:gap-2 ein:mt-6", className)}
    {...props}
  />
)
GlassAlertDialogFooter.displayName = "GlassAlertDialogFooter"

const GlassAlertDialogTitle = React.forwardRef<
  React.ElementRef<typeof AlertDialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof AlertDialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <AlertDialogPrimitive.Title ref={ref} className={cn("ein:text-lg ein:font-semibold ein:text-white", className)} {...props} />
))
GlassAlertDialogTitle.displayName = AlertDialogPrimitive.Title.displayName

const GlassAlertDialogDescription = React.forwardRef<
  React.ElementRef<typeof AlertDialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof AlertDialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <AlertDialogPrimitive.Description ref={ref} className={cn("ein:text-sm ein:text-white/60", className)} {...props} />
))
GlassAlertDialogDescription.displayName = AlertDialogPrimitive.Description.displayName

const GlassAlertDialogAction = React.forwardRef<
  React.ElementRef<typeof AlertDialogPrimitive.Action>,
  React.ComponentPropsWithoutRef<typeof AlertDialogPrimitive.Action>
>(({ className, ...props }, ref) => (
  <AlertDialogPrimitive.Action
    ref={ref}
    className={cn(glassButtonVariants({ variant: "primary" }), className)}
    {...props}
  />
))
GlassAlertDialogAction.displayName = AlertDialogPrimitive.Action.displayName

const GlassAlertDialogCancel = React.forwardRef<
  React.ElementRef<typeof AlertDialogPrimitive.Cancel>,
  React.ComponentPropsWithoutRef<typeof AlertDialogPrimitive.Cancel>
>(({ className, ...props }, ref) => (
  <AlertDialogPrimitive.Cancel
    ref={ref}
    className={cn(glassButtonVariants({ variant: "outline" }), className)}
    {...props}
  />
))
GlassAlertDialogCancel.displayName = AlertDialogPrimitive.Cancel.displayName

export {
  GlassAlertDialog,
  GlassAlertDialogPortal,
  GlassAlertDialogOverlay,
  GlassAlertDialogTrigger,
  GlassAlertDialogContent,
  GlassAlertDialogHeader,
  GlassAlertDialogFooter,
  GlassAlertDialogTitle,
  GlassAlertDialogDescription,
  GlassAlertDialogAction,
  GlassAlertDialogCancel,
}
