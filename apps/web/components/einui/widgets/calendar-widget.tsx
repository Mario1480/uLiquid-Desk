"use client";

import * as React from "react";
import { cn } from "@/components/einui/utils";
import { ChevronLeft, ChevronRight, Plus, Clock } from "lucide-react";
import { GlassWidgetBase } from "./base-widget";

// Helper: returns the start-of-month Date for a given date
function getMonthStart(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

interface CalendarWidgetProps {
  date?: Date;
  selectedDate?: Date;
  onDateSelect?: (date: Date) => void;
  className?: string;
}

function CalendarWidget({
  date,
  selectedDate,
  onDateSelect,
  className,
}: CalendarWidgetProps) {
  const [internalDate, setInternalDate] = React.useState<Date | null>(date ?? null);

  // Always create the month state (avoid conditional hooks). Use a deterministic fallback date.
  const [currentMonth, setCurrentMonth] = React.useState<Date>(() =>
    getMonthStart(date ?? new Date(0))
  );

  // On mount/client, set "now" if no date prop was provided.
  React.useLayoutEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (!date) setInternalDate(new Date());
  }, [date]);

  // When internalDate is ready, sync currentMonth.
  React.useLayoutEffect(() => {
    if (internalDate) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setCurrentMonth(getMonthStart(internalDate));
    }
  }, [internalDate]);

  if (!internalDate) {
    // Lightweight client-side loading state to avoid using `new Date()` during prerender
    return (
      <GlassWidgetBase className={cn("ein:min-w-60 ein:p-4", className)} glowColor="purple">
        <div className="ein:h-6 ein:w-36 ein:bg-white/8 ein:rounded ein:animate-pulse" />
        <div className="ein:h-36 ein:w-full ein:mt-3 ein:bg-white/8 ein:rounded ein:animate-pulse" />
      </GlassWidgetBase>
    );
  }

  const selected = selectedDate ?? internalDate;

  const monthName = currentMonth.toLocaleDateString("en-US", { month: "short" });
  const year = currentMonth.getFullYear();

  const firstDay = new Date(currentMonth.getFullYear(), currentMonth.getMonth(), 1);
  const lastDay = new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 0);
  const startPadding = firstDay.getDay();
  const daysInMonth = lastDay.getDate();

  const days = Array.from({ length: startPadding + daysInMonth }, (_, i) => {
    if (i < startPadding) return null;
    return i - startPadding + 1;
  });

  const prevMonth = () => {
    setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() - 1, 1));
  };

  const nextMonth = () => {
    setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 1));
  };

  const isSelected = (day: number) => {
    return (
      day === selected.getDate() &&
      currentMonth.getMonth() === selected.getMonth() &&
      currentMonth.getFullYear() === selected.getFullYear()
    );
  };

  const isToday = (day: number) => {
    const today = new Date();
    return (
      day === today.getDate() &&
      currentMonth.getMonth() === today.getMonth() &&
      currentMonth.getFullYear() === today.getFullYear()
    );
  };

  return (
    <GlassWidgetBase className={cn("ein:min-w-60", className)} size="sm" glowColor="purple">
      {/* ...existing UI... */}
      <div className="ein:flex ein:items-center ein:justify-between ein:mb-3">
        <button
          onClick={prevMonth}
          className="ein:p-1.5 ein:rounded-lg ein:hover:bg-white/10 ein:text-white/60 ein:hover:text-white ein:transition-colors"
          aria-label="Previous month"
        >
          <ChevronLeft className="ein:w-4 ein:h-4" />
        </button>
        <span className="ein:text-white ein:font-medium">
          {monthName} {year}
        </span>
        <button
          onClick={nextMonth}
          className="ein:p-1.5 ein:rounded-lg ein:hover:bg-white/10 ein:text-white/60 ein:hover:text-white ein:transition-colors"
          aria-label="Next month"
        >
          <ChevronRight className="ein:w-4 ein:h-4" />
        </button>
      </div>

      <div className="ein:grid ein:grid-cols-7 ein:gap-1 ein:text-center">
        {["S", "M", "T", "W", "T", "F", "S"].map((d, i) => (
          <div key={i} className="ein:text-xs ein:text-white/70 ein:py-1 ein:font-medium">
            {d}
          </div>
        ))}
        {days.map((day, i) => (
          <button
            key={i}
            onClick={() => {
              if (day && onDateSelect) {
                onDateSelect(new Date(currentMonth.getFullYear(), currentMonth.getMonth(), day));
              }
            }}
            disabled={day === null}
            className={cn(
              "ein:text-xs ein:py-1.5 ein:rounded-full ein:transition-all",
              day === null && "ein:invisible",
              day !== null && "ein:text-white/70 ein:hover:bg-white/15 ein:cursor-pointer",
              day !== null && isSelected(day) && "ein:bg-white/25 ein:text-white ein:font-medium ein:shadow-sm",
              day !== null && isToday(day) && !isSelected(day) && "ein:ring-1 ein:ring-cyan-400/50"
            )}
          >
            {day}
          </button>
        ))}
      </div>
    </GlassWidgetBase>
  );
}

interface CompactCalendarWidgetProps {
  date?: Date;
  className?: string;
}

function CompactCalendarWidget({ date, className }: CompactCalendarWidgetProps) {
  const [internalDate, setInternalDate] = React.useState<Date | null>(date ?? null);
  React.useLayoutEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (!date) setInternalDate(new Date());
  }, [date]);

  if (!internalDate) {
    // Render a lightweight client-side loading state to avoid using `new Date()` during prerender
    return (
      <GlassWidgetBase
        className={cn("ein:flex ein:flex-col ein:items-center ein:justify-center ein:min-w-30", className)}
        glowColor="purple"
      >
        <div className="ein:h-4 ein:w-20 ein:bg-white/8 ein:rounded ein:animate-pulse" />
        <div className="ein:h-12 ein:w-16 ein:mt-2 ein:bg-white/8 ein:rounded ein:animate-pulse" />
      </GlassWidgetBase>
    );
  }

  const dayName = internalDate.toLocaleDateString("en-US", { weekday: "short" });
  const monthName = internalDate.toLocaleDateString("en-US", { month: "short" });
  const dayNumber = internalDate.getDate();

  return (
    <GlassWidgetBase
      className={cn("ein:flex ein:flex-col ein:items-center ein:justify-center ein:min-w-30", className)}
      glowColor="purple"
    >
      <div className="ein:flex ein:items-center ein:gap-1.5 ein:text-base">
        <span className="ein:text-white/60">{dayName}</span>
        <span className="ein:text-cyan-400 ein:font-medium">{monthName}</span>
      </div>
      <div className="ein:text-6xl ein:font-light ein:text-white ein:tracking-tight">{dayNumber}</div>
    </GlassWidgetBase>
  );
}

interface Event {
  id: string;
  title: string;
  time: string;
  color?: string;
}

interface EventsCalendarWidgetProps {
  date?: Date;
  events?: Event[];
  className?: string;
}

function EventsCalendarWidget({
  date,
  events = [],
  className,
}: EventsCalendarWidgetProps) {
  const [internalDate, setInternalDate] = React.useState<Date | null>(date ?? null);
  React.useLayoutEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (!date) setInternalDate(new Date());
  }, [date]);

  if (!internalDate) {
    return (
      <GlassWidgetBase className={cn("ein:min-w-65", className)} size="lg" glowColor="purple">
        <div className="ein:h-6 ein:w-24 ein:bg-white/8 ein:rounded ein:animate-pulse" />
        <div className="ein:h-24 ein:w-full ein:mt-3 ein:bg-white/8 ein:rounded ein:animate-pulse" />
      </GlassWidgetBase>
    );
  }

  const dayName = internalDate.toLocaleDateString("en-US", { weekday: "long" });
  const monthName = internalDate.toLocaleDateString("en-US", { month: "long" });
  const dayNumber = internalDate.getDate();

  return (
    <GlassWidgetBase className={cn("ein:min-w-65", className)} size="lg" glowColor="purple">
      <div className="ein:flex ein:items-start ein:justify-between ein:mb-4">
        <div>
          <div className="ein:text-white/60 ein:text-sm">{dayName}</div>
          <div className="ein:text-white ein:text-2xl ein:font-light">
            {monthName} {dayNumber}
          </div>
        </div>
        <button className="ein:p-2 ein:rounded-lg ein:bg-white/10 ein:hover:bg-white/20 ein:text-white/60 ein:hover:text-white ein:transition-colors">
          <Plus className="ein:w-4 ein:h-4" />
        </button>
      </div>

      {events.length > 0 ? (
        <div className="ein:space-y-2">
          {events.map((event) => (
            <div
              key={event.id}
              className="ein:flex ein:items-center ein:gap-3 ein:p-2 ein:rounded-lg ein:bg-white/5 ein:hover:bg-white/10 ein:transition-colors ein:border ein:border-white/5"
            >
              <div className={cn("ein:w-1 ein:h-8 ein:rounded-full", event.color || "ein:bg-cyan-500")} />
              <div className="ein:flex-1 ein:min-w-0">
                <div className="ein:text-white ein:text-sm ein:truncate">{event.title}</div>
                <div className="ein:text-white/70 ein:text-xs ein:flex ein:items-center ein:gap-1">
                  <Clock className="ein:w-3 ein:h-3" />
                  {event.time}
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="ein:text-center ein:py-4 ein:text-white/70 ein:text-sm">No events today</div>
      )}
    </GlassWidgetBase>
  );
}

export { CalendarWidget, CompactCalendarWidget, EventsCalendarWidget };
