"use client"

import * as React from "react"
import { EinPortalTheme } from "../portal-theme"
import { Dialog as SheetPrimitive} from "radix-ui"
import { cva, type VariantProps } from "class-variance-authority"
import { X } from "lucide-react"
import { cn } from "@/components/einui/utils"

const GlassSheet = SheetPrimitive.Root

const GlassSheetTrigger = SheetPrimitive.Trigger

const GlassSheetClose = SheetPrimitive.Close

const GlassSheetPortal = ({children, ...props}: React.ComponentPropsWithoutRef<typeof SheetPrimitive.Portal>) => <SheetPrimitive.Portal {...props}><EinPortalTheme>{children}</EinPortalTheme></SheetPrimitive.Portal>

const GlassSheetOverlay = React.forwardRef<
  React.ElementRef<typeof SheetPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof SheetPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <SheetPrimitive.Overlay
    data-ein-sheet-overlay="true"
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
GlassSheetOverlay.displayName = SheetPrimitive.Overlay.displayName

const sheetVariants = cva(
  cn(
    "ein:fixed ein:z-50 ein:gap-4 ein:p-6",
    " ein:border ein:border-white/20",
    "",
    "ein:transition ein:ease-in-out ein:duration-300",
    "ein:data-[state=open]:animate-in ein:data-[state=closed]:animate-out",
    "ein:before:absolute ein:before:inset-0",
    "ein:before:bg-gradient-to-b ein:before:from-white/15 ein:before:to-transparent ein:before:pointer-events-none",
  ),
  {
    variants: {
      side: {
        top: cn(
          "ein:inset-x-0 ein:top-0 ein:border-b ein:rounded-b-2xl",
          "ein:data-[state=closed]:slide-out-to-top ein:data-[state=open]:slide-in-from-top",
        ),
        bottom: cn(
          "ein:inset-x-0 ein:bottom-0 ein:border-t ein:rounded-t-2xl",
          "ein:data-[state=closed]:slide-out-to-bottom ein:data-[state=open]:slide-in-from-bottom",
        ),
        left: cn(
          "ein:inset-y-0 ein:left-0 ein:h-full ein:w-3/4 ein:border-r ein:rounded-r-2xl ein:sm:max-w-sm",
          "ein:data-[state=closed]:slide-out-to-left ein:data-[state=open]:slide-in-from-left",
        ),
        right: cn(
          "ein:inset-y-0 ein:right-0 ein:h-full ein:w-3/4 ein:border-l ein:rounded-l-2xl ein:sm:max-w-sm",
          "ein:data-[state=closed]:slide-out-to-right ein:data-[state=open]:slide-in-from-right",
        ),
      },
    },
    defaultVariants: {
      side: "right",
    },
  },
)

interface GlassSheetContentProps
  extends React.ComponentPropsWithoutRef<typeof SheetPrimitive.Content>,
    VariantProps<typeof sheetVariants> {}

const GlassSheetContent = React.forwardRef<React.ElementRef<typeof SheetPrimitive.Content>, GlassSheetContentProps>(
  ({ side = "right", className, children, ...props }, ref) => (
    <GlassSheetPortal>
      <GlassSheetOverlay />
      <SheetPrimitive.Content data-ein-overlay="true" ref={ref} className={cn(sheetVariants({ side }), className)} {...props}>
        <div className="ein:relative ein:z-10">{children}</div>
        <SheetPrimitive.Close className="ein:absolute ein:right-4 ein:top-4 ein:rounded-lg ein:p-1 ein:text-white/60 ein:transition-all ein:hover:text-white ein:hover:bg-white/10 ein:focus:outline-none ein:focus:ring-2 ein:focus:ring-white/50">
          <X className="ein:h-4 ein:w-4" />
          <span className="ein:sr-only">Close</span>
        </SheetPrimitive.Close>
      </SheetPrimitive.Content>
    </GlassSheetPortal>
  ),
)
GlassSheetContent.displayName = SheetPrimitive.Content.displayName

const GlassSheetHeader = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn("ein:flex ein:flex-col ein:gap-2 ein:text-left", className)} {...props} />
)
GlassSheetHeader.displayName = "GlassSheetHeader"

const GlassSheetFooter = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn("ein:flex ein:flex-row ein:justify-end ein:gap-2", className)} {...props} />
)
GlassSheetFooter.displayName = "GlassSheetFooter"

const GlassSheetTitle = React.forwardRef<
  React.ElementRef<typeof SheetPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof SheetPrimitive.Title>
>(({ className, ...props }, ref) => (
  <SheetPrimitive.Title ref={ref} className={cn("ein:text-lg ein:font-semibold ein:text-white", className)} {...props} />
))
GlassSheetTitle.displayName = SheetPrimitive.Title.displayName

const GlassSheetDescription = React.forwardRef<
  React.ElementRef<typeof SheetPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof SheetPrimitive.Description>
>(({ className, ...props }, ref) => (
  <SheetPrimitive.Description ref={ref} className={cn("ein:text-sm ein:text-white/60", className)} {...props} />
))
GlassSheetDescription.displayName = SheetPrimitive.Description.displayName

export {
  GlassSheet,
  GlassSheetPortal,
  GlassSheetOverlay,
  GlassSheetTrigger,
  GlassSheetClose,
  GlassSheetContent,
  GlassSheetHeader,
  GlassSheetFooter,
  GlassSheetTitle,
  GlassSheetDescription,
}
