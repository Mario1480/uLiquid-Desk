"use client";

import * as React from "react";
import { cn } from "@/components/einui/utils";
import { Sun, Moon, Play, Pause, RotateCcw } from "lucide-react";
import { GlassWidgetBase } from "./base-widget";

interface AnalogClockWidgetProps {
  time?: Date;
  showNumbers?: boolean;
  size?: "sm" | "md" | "lg";
  className?: string;
}

function AnalogClockWidget({
  time,
  showNumbers = true,
  size = "md",
  className,
}: AnalogClockWidgetProps) {
  const [currentTime, setCurrentTime] = React.useState<Date | undefined>(time);

  React.useLayoutEffect(() => {
    if (time) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setCurrentTime(time);
      return;
    }

    setCurrentTime(new Date());
    const interval = setInterval(() => {

      setCurrentTime(new Date());
    }, 1000);
    return () => clearInterval(interval);
  }, [time]);

  if (!currentTime) return null;

  const seconds = currentTime.getSeconds();
  const minutes = currentTime.getMinutes();
  const hours = currentTime.getHours() % 12;

  const secondDegrees = seconds * 6;
  const minuteDegrees = minutes * 6 + seconds * 0.1;
  const hourDegrees = hours * 30 + minutes * 0.5;

  const sizeConfig = {
    sm: { container: "ein:size-24", numbers: "ein:text-[10px]", radius: 36 },
    md: { container: "ein:size-32", numbers: "ein:text-xs", radius: 42 },
    lg: { container: "ein:size-36", numbers: "ein:text-sm", radius: 42 },
  };

  const config = sizeConfig[size];
  const numbers = showNumbers ? [12, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] : [];

  return (
    <GlassWidgetBase className={cn("ein:p-3 ein:w-full ein:h-full ein:flex ein:items-center ein:justify-center", className)} size="sm" glowColor="blue">
      <div className={cn("ein:relative", config.container)}>
        {/* Clock face with glass effect */}
        <div className="ein:absolute ein:inset-0 ein:rounded-full ein:border ein:border-white/20  ein:bg-white/5 ein:backdrop-blur-sm ein:shadow-inner" />

        {numbers.map((num, i) => {
          const angle = (i * 30 - 90) * (Math.PI / 180);
          const x = 50 + config.radius * Math.cos(angle);
          const y = 50 + config.radius * Math.sin(angle);
          return (
            <span
              key={num}
              className={cn("ein:absolute ein:text-white/70 ein:font-light", config.numbers)}
              style={{
                left: `${x}%`,
                top: `${y}%`,
                transform: "translate(-50%, -50%)",
              }}
            >
              {num}
            </span>
          );
        })}

        {!showNumbers &&
          Array.from({ length: 12 }).map((_, i) => {
            const angle = (i * 30 - 90) * (Math.PI / 180);
            return (
              <div
                key={i}
                className="ein:absolute ein:size-1.5 ein:rounded-full ein:bg-white/40"
                style={{
                  left: `${50 + config.radius * Math.cos(angle)}%`,
                  top: `${50 + config.radius * Math.sin(angle)}%`,
                  transform: "translate(-50%, -50%)",
                }}
              />
            );
          })}

        {/* Center dot */}
        <div className="ein:absolute ein:left-1/2 ein:top-1/2 ein:w-2.5 ein:h-2.5 ein:-translate-x-1/2 ein:-translate-y-1/2 ein:rounded-full ein:bg-white/90 ein:z-20 ein:shadow-lg" />

        {/* Hour hand */}
        <div
          className="ein:absolute ein:left-1/2 ein:top-1/2 ein:w-1 ein:rounded-full ein:bg-white/90 ein:origin-bottom ein:shadow-md"
          style={{
            height: size === "lg" ? "28px" : size === "md" ? "22px" : "18px",
            transform: `translateX(-50%) translateY(-100%) rotate(${hourDegrees}deg)`,
          }}
        />

        {/* Minute hand */}
        <div
          className="ein:absolute ein:left-1/2 ein:top-1/2 ein:w-0.5 ein:rounded-full ein:bg-white/80 ein:origin-bottom ein:shadow-sm"
          style={{
            height: size === "lg" ? "36px" : size === "md" ? "28px" : "22px",
            transform: `translateX(-50%) translateY(-100%) rotate(${minuteDegrees}deg)`,
          }}
        />

        {/* Second hand */}
        <div
          className="ein:absolute ein:left-1/2 ein:top-1/2 ein:w-px ein:bg-cyan-400 ein:origin-bottom"
          style={{
            height: size === "lg" ? "40px" : size === "md" ? "32px" : "26px",
            transform: `translateX(-50%) translateY(-100%) rotate(${secondDegrees}deg)`,
          }}
        />
      </div>
    </GlassWidgetBase>
  );
}

interface DigitalClockWidgetProps {
  time?: Date;
  showSeconds?: boolean;
  format?: "12h" | "24h";
  className?: string;
}

function DigitalClockWidget({
  time,
  showSeconds = true,
  format = "12h",
  className,
}: DigitalClockWidgetProps) {
  const [currentTime, setCurrentTime] = React.useState<Date | undefined>(time);

  React.useLayoutEffect(() => {
    if (time) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setCurrentTime(time);
      return;
    }

    setCurrentTime(new Date());
    const interval = setInterval(() => {

      setCurrentTime(new Date());
    }, 1000);
    return () => clearInterval(interval);
  }, [time]);

  if (!currentTime) return null;

  const hours = currentTime.getHours();
  const minutes = currentTime.getMinutes();
  const seconds = currentTime.getSeconds();

  const displayHours = format === "12h" ? hours % 12 || 12 : hours;
  const period = hours >= 12 ? "PM" : "AM";

  return (
    <GlassWidgetBase
      className={cn("ein:w-full ein:min-w-0", className)}
      glowColor="cyan"
    >
      <div className="ein:flex ein:flex-col ein:items-center ein:justify-center ein:h-full">
        <div className="ein:flex ein:items-baseline ein:gap-1">
          <span className="ein:text-4xl ein:font-light ein:text-white ein:tabular-nums">
            {displayHours.toString().padStart(2, "0")}:{minutes.toString().padStart(2, "0")}
          </span>
          {showSeconds && (
            <span className="ein:text-xl ein:text-white/60 ein:tabular-nums">
              :{seconds.toString().padStart(2, "0")}
            </span>
          )}
          {format === "12h" && <span className="ein:text-sm ein:text-white/70 ein:ml-1">{period}</span>}
        </div>
      </div>
    </GlassWidgetBase>
  );
}

interface WorldClockWidgetProps {
  clocks: Array<{
    city: string;
    timezone: string;
    isDay?: boolean;
  }>;
  className?: string;
}

function WorldClockWidget({ clocks, className }: WorldClockWidgetProps) {
  const [times, setTimes] = React.useState<string[]>([]);

  React.useEffect(() => {
    const updateTimes = () => {
      const newTimes = clocks.map((clock) => {
        try {
          return new Date().toLocaleTimeString("en-US", {
            timeZone: clock.timezone,
            hour: "numeric",
            minute: "2-digit",
            hour12: true,
          });
        } catch {
          return "--:--";
        }
      });
      setTimes(newTimes);
    };
    updateTimes();
    const interval = setInterval(updateTimes, 1000);
    return () => clearInterval(interval);
  }, [clocks]);

  return (
    <GlassWidgetBase className={cn("ein:min-w-45", className)} glowColor="blue">
      <div className="ein:space-y-3">
        {clocks.map((clock, i) => (
          <div key={i} className="ein:flex ein:items-center ein:justify-between">
            <div className="ein:flex ein:items-center ein:gap-2">
              <span className="ein:text-white ein:font-medium">{clock.city}</span>
              {clock.isDay !== undefined &&
                (clock.isDay ? (
                  <Sun className="ein:w-4 ein:h-4 ein:text-amber-400" />
                ) : (
                  <Moon className="ein:w-4 ein:h-4 ein:text-blue-300" />
                ))}
            </div>
            <span className="ein:text-white/80 ein:text-lg ein:tabular-nums">{times[i] || "--:--"}</span>
          </div>
        ))}
      </div>
    </GlassWidgetBase>
  );
}

interface StopwatchWidgetProps {
  className?: string;
}

function StopwatchWidget({ className }: StopwatchWidgetProps) {
  const [time, setTime] = React.useState(0);
  const [isRunning, setIsRunning] = React.useState(false);

  React.useEffect(() => {
    let interval: NodeJS.Timeout;
    if (isRunning) {
      interval = setInterval(() => setTime((t) => t + 10), 10);
    }
    return () => clearInterval(interval);
  }, [isRunning]);

  const formatTime = (ms: number) => {
    const minutes = Math.floor(ms / 60000);
    const seconds = Math.floor((ms % 60000) / 1000);
    const centiseconds = Math.floor((ms % 1000) / 10);
    return `${minutes.toString().padStart(2, "0")}:${seconds
      .toString()
      .padStart(2, "0")}.${centiseconds.toString().padStart(2, "0")}`;
  };

  const reset = () => {
    setIsRunning(false);
    setTime(0);
  };

  return (
    <GlassWidgetBase className={cn(className)} glowColor="cyan">
      <div className="ein:text-3xl ein:font-light ein:text-white ein:text-center ein:mb-4 ein:tabular-nums">
        {formatTime(time)}
      </div>
      <div className="ein:flex ein:items-center ein:justify-center ein:gap-3">
        <button
          onClick={reset}
          className="ein:p-2.5 ein:rounded-full ein:bg-white/10 ein:hover:bg-white/20 ein:text-white/60 ein:hover:text-white ein:transition-colors"
          aria-label="Reset"
        >
          <RotateCcw className="ein:w-4 ein:h-4" />
        </button>
        <button
          onClick={() => setIsRunning(!isRunning)}
          className={cn(
            "ein:p-3 ein:rounded-full ein:transition-colors",
            isRunning
              ? "ein:bg-red-500/20 ein:hover:bg-red-500/30 ein:text-red-400"
              : "ein:bg-emerald-500/20 ein:hover:bg-emerald-500/30 ein:text-emerald-400"
          )}
          aria-label={isRunning ? "Pause" : "Start"}
        >
          {isRunning ? <Pause className="ein:w-5 ein:h-5" /> : <Play className="ein:w-5 ein:h-5 ein:ml-0.5" />}
        </button>
      </div>
    </GlassWidgetBase>
  );
}

interface TimerWidgetProps {
  initialMinutes?: number;
  className?: string;
}

function TimerWidget({ initialMinutes = 5, className }: TimerWidgetProps) {
  const [timeLeft, setTimeLeft] = React.useState(initialMinutes * 60 * 1000);
  const [isRunning, setIsRunning] = React.useState(false);
  const [initialTime] = React.useState(initialMinutes * 60 * 1000);

  React.useEffect(() => {
    let interval: NodeJS.Timeout;
    if (isRunning && timeLeft > 0) {
      interval = setInterval(() => setTimeLeft((t) => Math.max(0, t - 1000)), 1000);
    }
    return () => clearInterval(interval);
  }, [isRunning, timeLeft]);

  const formatTime = (ms: number) => {
    const minutes = Math.floor(ms / 60000);
    const seconds = Math.floor((ms % 60000) / 1000);
    return `${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
  };

  const reset = () => {
    setIsRunning(false);
    setTimeLeft(initialTime);
  };

  const progress = (timeLeft / initialTime) * 100;

  return (
    <GlassWidgetBase
      className={cn("ein:min-w-40", className)}
      glowColor={timeLeft === 0 ? "red" : "green"}
    >
      <div className="ein:relative ein:flex ein:items-center ein:justify-center ein:mb-4 ein:p-2">
        <svg className="ein:w-24 ein:h-24 ein:-rotate-90" viewBox="0 0 96 96">
          <circle
            cx="48"
            cy="48"
            r="42"
            stroke="rgba(255,255,255,0.1)"
            strokeWidth="4"
            fill="none"
          />
          <circle
            cx="48"
            cy="48"
            r="42"
            stroke={timeLeft === 0 ? "#ef4444" : "#22c55e"}
            strokeWidth="4"
            fill="none"
            strokeLinecap="round"
            strokeDasharray={263.89}
            strokeDashoffset={263.89 * (1 - progress / 100)}
            className="ein:transition-all ein:duration-1000"
          />
        </svg>
        <div className="ein:absolute ein:text-2xl ein:font-light ein:text-white ein:tabular-nums">
          {formatTime(timeLeft)}
        </div>
      </div>
      <div className="ein:flex ein:items-center ein:justify-center ein:gap-3">
        <button
          onClick={reset}
          className="ein:p-2.5 ein:rounded-full ein:bg-white/10 ein:hover:bg-white/20 ein:text-white/60 ein:hover:text-white ein:transition-colors"
          aria-label="Reset"
        >
          <RotateCcw className="ein:w-4 ein:h-4" />
        </button>
        <button
          onClick={() => setIsRunning(!isRunning)}
          className={cn(
            "ein:p-3 ein:rounded-full ein:transition-colors",
            isRunning
              ? "ein:bg-red-500/20 ein:hover:bg-red-500/30 ein:text-red-400"
              : "ein:bg-emerald-500/20 ein:hover:bg-emerald-500/30 ein:text-emerald-400"
          )}
          aria-label={isRunning ? "Pause" : "Start"}
        >
          {isRunning ? <Pause className="ein:w-5 ein:h-5" /> : <Play className="ein:w-5 ein:h-5 ein:ml-0.5" />}
        </button>
      </div>
    </GlassWidgetBase>
  );
}

export { AnalogClockWidget, DigitalClockWidget, WorldClockWidget, StopwatchWidget, TimerWidget };
