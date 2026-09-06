"use client"

import * as React from "react"
import { X, CheckCircle, AlertCircle, AlertTriangle, Info } from "lucide-react"
import { cn } from "@/components/einui/utils"

type NotificationType = "success" | "error" | "warning" | "info"
type NotificationPosition = "top-right" | "top-left" | "bottom-right" | "bottom-left" | "top-center" | "bottom-center"

interface Notification {
  id: string
  type: NotificationType
  title: string
  description?: string
  duration?: number
}

interface NotificationContextType {
  notifications: Notification[]
  addNotification: (notification: Omit<Notification, "id">) => void
  removeNotification: (id: string) => void
}

const NotificationContext = React.createContext<NotificationContextType | null>(null)

export function useNotification() {
  const context = React.useContext(NotificationContext)
  if (!context) {
    throw new Error("useNotification must be used within a GlassNotificationProvider")
  }
  return context
}

export function GlassNotificationProvider({
  children,
  position = "bottom-right",
}: {
  children: React.ReactNode
  position?: NotificationPosition
}) {
  const [notifications, setNotifications] = React.useState<Notification[]>([])

  const addNotification = React.useCallback((notification: Omit<Notification, "id">) => {
    const id = Math.random().toString(36).substring(2, 9)
    setNotifications((prev) => [...prev, { ...notification, id }])

    if (notification.duration !== 0) {
      setTimeout(() => {
        setNotifications((prev) => prev.filter((n) => n.id !== id))
      }, notification.duration || 5000)
    }
  }, [])

  const removeNotification = React.useCallback((id: string) => {
    setNotifications((prev) => prev.filter((n) => n.id !== id))
  }, [])

  return (
    <NotificationContext.Provider value={{ notifications, addNotification, removeNotification }}>
      {children}
      <GlassNotificationContainer position={position} />
    </NotificationContext.Provider>
  )
}

const typeConfig = {
  success: {
    icon: CheckCircle,
    gradient: "ein:from-emerald-500/30 ein:to-green-500/30",
    border: "ein:border-emerald-400/30",
    iconColor: "ein:text-emerald-400",
  },
  error: {
    icon: AlertCircle,
    gradient: "ein:from-red-500/30 ein:to-rose-500/30",
    border: "ein:border-red-400/30",
    iconColor: "ein:text-red-400",
  },
  warning: {
    icon: AlertTriangle,
    gradient: "ein:from-amber-500/30 ein:to-yellow-500/30",
    border: "ein:border-amber-400/30",
    iconColor: "ein:text-amber-400",
  },
  info: {
    icon: Info,
    gradient: "ein:from-cyan-500/30 ein:to-blue-500/30",
    border: "ein:border-cyan-400/30",
    iconColor: "ein:text-cyan-400",
  },
}

const positionStyles: Record<NotificationPosition, { container: string; animation: string }> = {
  "top-right": {
    container: "ein:top-4 ein:right-4",
    animation: "ein:slide-in-from-right-full",
  },
  "top-left": {
    container: "ein:top-4 ein:left-4",
    animation: "ein:slide-in-from-left-full",
  },
  "bottom-right": {
    container: "ein:bottom-4 ein:right-4",
    animation: "ein:slide-in-from-right-full",
  },
  "bottom-left": {
    container: "ein:bottom-4 ein:left-4",
    animation: "ein:slide-in-from-left-full",
  },
  "top-center": {
    container: "ein:top-4 ein:left-1/2 ein:-translate-x-1/2",
    animation: "ein:slide-in-from-top-full",
  },
  "bottom-center": {
    container: "ein:bottom-4 ein:left-1/2 ein:-translate-x-1/2",
    animation: "ein:slide-in-from-bottom-full",
  },
}

function GlassNotificationContainer({ position = "bottom-right" }: { position?: NotificationPosition }) {
  const { notifications, removeNotification } = useNotification()
  const positionConfig = positionStyles[position]

  return (
    <div
      className={cn("ein:fixed ein:z-50 ein:flex ein:flex-col ein:gap-3 ein:max-w-sm ein:w-full ein:pointer-events-none", positionConfig.container)}
      role="region"
      aria-label="Notifications"
    >
      {notifications.map((notification, index) => (
        <GlassNotificationItem
          key={notification.id}
          notification={notification}
          onClose={() => removeNotification(notification.id)}
          animationClass={positionConfig.animation}
          style={{
            transform: `scale(${1 - index * 0.02})`,
            opacity: 1 - index * 0.1,
          }}
        />
      ))}
    </div>
  )
}

interface GlassNotificationItemProps {
  notification: Notification
  onClose: () => void
  style?: React.CSSProperties
  animationClass?: string
}

function GlassNotificationItem({
  notification,
  onClose,
  style,
  animationClass = "ein:slide-in-from-right-full",
}: GlassNotificationItemProps) {
  const config = typeConfig[notification.type]
  const Icon = config.icon
  const [progress, setProgress] = React.useState(100)
  const duration = notification.duration || 5000

  React.useEffect(() => {
    if (duration === 0) return

    const interval = setInterval(() => {
      setProgress((prev) => {
        const newProgress = prev - 100 / (duration / 100)
        return newProgress <= 0 ? 0 : newProgress
      })
    }, 100)

    return () => clearInterval(interval)
  }, [duration])

  return (
    <div
      className={cn("ein:pointer-events-auto ein:animate-in ein:fade-in ein:duration-300", animationClass)}
      style={style}
      role="alert"
    >
      <div className="ein:relative">
        <div className={cn("ein:absolute ein:-inset-1.5 ein:rounded-xl ein:bg-linear-to-r ein:blur-xl ein:opacity-60", config.gradient)} />

        {/* Main container with enhanced glass */}
        <div
          className={cn(
            "ein:relative ein:rounded-xl ein:border",
            "ein:bg-white/10 ein:backdrop-blur-2xl",
            "ein:shadow-[0_8px_32px_rgba(0,0,0,0.3),inset_0_1px_1px_rgba(255,255,255,0.15)]",
            "ein:overflow-hidden",
            config.border,
          )}
        >
          {/* Glass highlight layers */}
          <div className="ein:absolute ein:inset-0 ein:rounded-xl ein:bg-linear-to-b ein:from-white/15 ein:to-transparent ein:pointer-events-none" />
          <div className="ein:absolute ein:inset-0 ein:rounded-xl ein:bg-linear-to-tr ein:from-transparent ein:to-white/10 ein:pointer-events-none" />

          <div className="ein:relative ein:p-4 ein:flex ein:items-start ein:gap-3">
            <div
              className={cn(
                "ein:flex ein:items-center ein:justify-center ein:w-8 ein:h-8 ein:rounded-lg ein:shrink-0",
                "ein:border ein:border-white/10",
                `ein:bg-linear-to-br ${config.gradient}`,
              )}
            >
              <Icon className={cn("ein:w-5 ein:h-5", config.iconColor)} aria-hidden="true" />
            </div>

            <div className="ein:flex-1 ein:min-w-0">
              <h4 className="ein:font-medium ein:text-white">{notification.title}</h4>
              {notification.description && <p className="ein:mt-1 ein:text-sm ein:text-white/60">{notification.description}</p>}
            </div>

            <button
              onClick={onClose}
              aria-label="Dismiss notification"
              className="ein:shrink-0 ein:p-1.5 ein:rounded-lg ein:text-white/70 ein:hover:text-white ein:hover:bg-white/10 ein:transition-colors"
            >
              <X className="ein:w-4 ein:h-4" />
            </button>
          </div>

          {/* Progress bar */}
          {duration !== 0 && (
            <div className="ein:h-1 ein:bg-white/5">
              <div
                className={cn("ein:h-full ein:transition-all ein:duration-100 ein:ease-linear", `ein:bg-linear-to-r ${config.gradient}`)}
                style={{ width: `${progress}%` }}
                role="progressbar"
                aria-valuenow={progress}
                aria-valuemin={0}
                aria-valuemax={100}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// Standalone notification component for demos
export function GlassNotification({
  type = "info",
  title,
  description,
  className,
}: {
  type?: NotificationType
  title: string
  description?: string
  className?: string
}) {
  const config = typeConfig[type]
  const Icon = config.icon

  return (
    <div className={cn("ein:relative", className)}>
      <div className={cn("ein:absolute ein:-inset-1.5 ein:rounded-xl ein:bg-linear-to-r ein:blur-xl ein:opacity-60", config.gradient)} />
      <div
        className={cn(
          "ein:relative ein:rounded-xl ein:border",
          "ein:bg-white/10 ein:backdrop-blur-2xl",
          "ein:shadow-[0_8px_32px_rgba(0,0,0,0.3),inset_0_1px_1px_rgba(255,255,255,0.15)]",
          config.border,
        )}
      >
        <div className="ein:absolute ein:inset-0 ein:rounded-xl ein:bg-linear-to-b ein:from-white/15 ein:to-transparent ein:pointer-events-none" />
        <div className="ein:relative ein:p-4 ein:flex ein:items-start ein:gap-3">
          <div
            className={cn(
              "ein:flex ein:items-center ein:justify-center ein:w-8 ein:h-8 ein:rounded-lg ein:shrink-0 ein:border ein:border-white/10",
              `ein:bg-linear-to-br ${config.gradient}`,
            )}
          >
            <Icon className={cn("ein:w-5 ein:h-5", config.iconColor)} />
          </div>
          <div className="ein:flex-1 ein:min-w-0">
            <h4 className="ein:font-medium ein:text-white">{title}</h4>
            {description && <p className="ein:mt-1 ein:text-sm ein:text-white/60">{description}</p>}
          </div>
        </div>
      </div>
    </div>
  )
}

export { GlassNotificationItem }
export type { NotificationPosition }
