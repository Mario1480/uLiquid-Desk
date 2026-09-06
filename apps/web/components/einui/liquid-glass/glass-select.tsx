"use client"

import * as React from "react"
import { EinPortalTheme } from "../portal-theme"
import * as SelectPrimitive from "@radix-ui/react-select"
import { Check, ChevronDown, ChevronUp } from "lucide-react"
import { cn } from "@/components/einui/utils"

const GlassSelect = SelectPrimitive.Root

const GlassSelectGroup = SelectPrimitive.Group

const GlassSelectValue = SelectPrimitive.Value

const GlassSelectTrigger = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Trigger>
>(({ className, children, ...props }, ref) => (
  <SelectPrimitive.Trigger
    ref={ref}
    className={cn(
      "ein:flex ein:h-10 ein:w-full ein:items-center ein:justify-between ein:gap-2 ein:rounded-xl ein:px-4 ein:py-2 ein:text-sm",
      "ein:bg-white/10 ein:backdrop-blur-xl ein:border ein:border-white/20",
      "ein:text-white ein:placeholder:text-white/70",
      "ein:shadow-[0_4px_16px_rgba(0,0,0,0.2)]",
      "ein:transition-all ein:duration-300",
      "ein:focus:outline-none ein:focus:border-white/40 ein:focus:bg-white/15",
      "ein:focus:ring-2 ein:focus:ring-cyan-400/30 ein:focus:ring-offset-0",
      "ein:disabled:cursor-not-allowed ein:disabled:opacity-50",
      "ein:[&>span]:line-clamp-1",
      className,
    )}
    {...props}
  >
    {children}
    <SelectPrimitive.Icon asChild>
      <ChevronDown className="ein:h-4 ein:w-4 ein:text-white/60" />
    </SelectPrimitive.Icon>
  </SelectPrimitive.Trigger>
))
GlassSelectTrigger.displayName = SelectPrimitive.Trigger.displayName

const GlassSelectScrollUpButton = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.ScrollUpButton>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.ScrollUpButton>
>(({ className, ...props }, ref) => (
  <SelectPrimitive.ScrollUpButton
    ref={ref}
    className={cn("ein:flex ein:cursor-default ein:items-center ein:justify-center ein:py-1", className)}
    {...props}
  >
    <ChevronUp className="ein:h-4 ein:w-4 ein:text-white/60" />
  </SelectPrimitive.ScrollUpButton>
))
GlassSelectScrollUpButton.displayName = SelectPrimitive.ScrollUpButton.displayName

const GlassSelectScrollDownButton = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.ScrollDownButton>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.ScrollDownButton>
>(({ className, ...props }, ref) => (
  <SelectPrimitive.ScrollDownButton
    ref={ref}
    className={cn("ein:flex ein:cursor-default ein:items-center ein:justify-center ein:py-1", className)}
    {...props}
  >
    <ChevronDown className="ein:h-4 ein:w-4 ein:text-white/60" />
  </SelectPrimitive.ScrollDownButton>
))
GlassSelectScrollDownButton.displayName = SelectPrimitive.ScrollDownButton.displayName

const GlassSelectContent = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Content>
>(({ className, children, position = "popper", ...props }, ref) => (
  <SelectPrimitive.Portal><EinPortalTheme>
    <SelectPrimitive.Content
      ref={ref}
      className={cn(
        "ein:relative ein:z-50 ein:max-h-96 ein:min-w-32 ein:overflow-hidden ein:rounded-xl",
        "ein:bg-white/10 ein:backdrop-blur-2xl ein:border ein:border-white/20",
        "ein:shadow-[0_8px_32px_rgba(0,0,0,0.4)]",
        "ein:data-[state=open]:animate-in ein:data-[state=closed]:animate-out",
        "ein:data-[state=closed]:fade-out-0 ein:data-[state=open]:fade-in-0",
        "ein:data-[state=closed]:zoom-out-95 ein:data-[state=open]:zoom-in-95",
        "ein:data-[side=bottom]:slide-in-from-top-2 ein:data-[side=left]:slide-in-from-right-2",
        "ein:data-[side=right]:slide-in-from-left-2 ein:data-[side=top]:slide-in-from-bottom-2",
        position === "popper" &&
          "ein:data-[side=bottom]:translate-y-1 ein:data-[side=left]:-translate-x-1 ein:data-[side=right]:translate-x-1 ein:data-[side=top]:-translate-y-1",
        className,
      )}
      position={position}
      {...props}
    >
      <GlassSelectScrollUpButton />
      <SelectPrimitive.Viewport
        className={cn(
          "ein:p-1",
          position === "popper" &&
            "ein:h-(--radix-select-trigger-height) ein:w-full ein:min-w-(--radix-select-trigger-width)",
        )}
      >
        {children}
      </SelectPrimitive.Viewport>
      <GlassSelectScrollDownButton />
    </SelectPrimitive.Content>
  </EinPortalTheme></SelectPrimitive.Portal>
))
GlassSelectContent.displayName = SelectPrimitive.Content.displayName

const GlassSelectLabel = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Label>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Label>
>(({ className, ...props }, ref) => (
  <SelectPrimitive.Label
    ref={ref}
    className={cn("ein:px-2 ein:py-1.5 ein:text-sm ein:font-semibold ein:text-white/60", className)}
    {...props}
  />
))
GlassSelectLabel.displayName = SelectPrimitive.Label.displayName

const GlassSelectItem = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Item>
>(({ className, children, ...props }, ref) => (
  <SelectPrimitive.Item
    ref={ref}
    className={cn(
      "ein:relative ein:flex ein:w-full ein:cursor-pointer ein:select-none ein:items-center ein:rounded-lg ein:py-2 ein:pl-8 ein:pr-2 ein:text-sm",
      "ein:text-white/80 ein:outline-none",
      "ein:focus:bg-white/10 ein:focus:text-white",
      "ein:data-disabled:pointer-events-none ein:data-disabled:opacity-50",
      "ein:transition-colors ein:duration-150",
      className,
    )}
    {...props}
  >
    <span className="ein:absolute ein:left-2 ein:flex ein:h-3.5 ein:w-3.5 ein:items-center ein:justify-center">
      <SelectPrimitive.ItemIndicator>
        <Check className="ein:h-4 ein:w-4 ein:text-cyan-400" />
      </SelectPrimitive.ItemIndicator>
    </span>
    <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
  </SelectPrimitive.Item>
))
GlassSelectItem.displayName = SelectPrimitive.Item.displayName

const GlassSelectSeparator = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Separator>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Separator>
>(({ className, ...props }, ref) => (
  <SelectPrimitive.Separator ref={ref} className={cn("ein:-mx-1 ein:my-1 ein:h-px ein:bg-white/10", className)} {...props} />
))
GlassSelectSeparator.displayName = SelectPrimitive.Separator.displayName

export {
  GlassSelect,
  GlassSelectGroup,
  GlassSelectValue,
  GlassSelectTrigger,
  GlassSelectContent,
  GlassSelectLabel,
  GlassSelectItem,
  GlassSelectSeparator,
  GlassSelectScrollUpButton,
  GlassSelectScrollDownButton,
}
