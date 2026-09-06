"use client"

import * as React from "react"
import { Avatar as AvatarPrimitive } from 'radix-ui'
import { cn } from "@/components/einui/utils"

const GlassAvatar = React.forwardRef<
  React.ElementRef<typeof AvatarPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof AvatarPrimitive.Root> & {
    glowEffect?: boolean
  }
>(({ className, glowEffect = true, ...props }, ref) => (
  <div className="ein:relative">
    {glowEffect && (
      <div className="ein:absolute ein:-inset-1 ein:rounded-full ein:bg-linear-to-r ein:from-cyan-500/40 ein:via-blue-500/40 ein:to-purple-500/40 ein:blur-md ein:opacity-70" />
    )}
    <AvatarPrimitive.Root
      ref={ref}
      className={cn(
        "ein:relative ein:flex ein:h-10 ein:w-10 ein:shrink-0 ein:overflow-hidden ein:rounded-full",
        "ein:border-2 ein:border-white/30 ein:shadow-[0_4px_16px_rgba(0,0,0,0.2)]",
        className,
      )}
      {...props}
    />
  </div>
))
GlassAvatar.displayName = AvatarPrimitive.Root.displayName

const GlassAvatarImage = React.forwardRef<
  React.ElementRef<typeof AvatarPrimitive.Image>,
  React.ComponentPropsWithoutRef<typeof AvatarPrimitive.Image>
>(({ className, ...props }, ref) => (
  <AvatarPrimitive.Image ref={ref} className={cn("ein:aspect-square ein:h-full ein:w-full", className)} {...props} />
))
GlassAvatarImage.displayName = AvatarPrimitive.Image.displayName

const GlassAvatarFallback = React.forwardRef<
  React.ElementRef<typeof AvatarPrimitive.Fallback>,
  React.ComponentPropsWithoutRef<typeof AvatarPrimitive.Fallback>
>(({ className, ...props }, ref) => (
  <AvatarPrimitive.Fallback
    ref={ref}
    className={cn(
      "ein:flex ein:h-full ein:w-full ein:items-center ein:justify-center ein:rounded-full",
      "ein:bg-white/10 ein:backdrop-blur-xl ein:text-white/80 ein:text-sm ein:font-medium",
      className,
    )}
    {...props}
  />
))
GlassAvatarFallback.displayName = AvatarPrimitive.Fallback.displayName

export { GlassAvatar, GlassAvatarImage, GlassAvatarFallback }
