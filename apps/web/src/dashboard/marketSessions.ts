export type MarketSessionId = "newYork" | "london" | "frankfurt" | "tokyo" | "hongKong";

export type MarketSessionDefinition = {
  id: MarketSessionId;
  timeZone: string;
  sessions: Array<{ openMinute: number; closeMinute: number }>;
};

export const MARKET_SESSION_DEFINITIONS: MarketSessionDefinition[] = [
  { id: "newYork", timeZone: "America/New_York", sessions: [{ openMinute: 570, closeMinute: 960 }] },
  { id: "london", timeZone: "Europe/London", sessions: [{ openMinute: 480, closeMinute: 990 }] },
  { id: "frankfurt", timeZone: "Europe/Berlin", sessions: [{ openMinute: 540, closeMinute: 1050 }] },
  {
    id: "tokyo",
    timeZone: "Asia/Tokyo",
    sessions: [
      { openMinute: 540, closeMinute: 690 },
      { openMinute: 750, closeMinute: 930 }
    ]
  },
  {
    id: "hongKong",
    timeZone: "Asia/Hong_Kong",
    sessions: [
      { openMinute: 570, closeMinute: 720 },
      { openMinute: 780, closeMinute: 960 }
    ]
  }
];

type ZonedParts = {
  year: number;
  month: number;
  day: number;
  weekday: number;
  hour: number;
  minute: number;
};

const WEEKDAY_INDEX: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6
};

function zonedParts(date: Date, timeZone: string): ZonedParts {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "0";
  return {
    year: Number(value("year")),
    month: Number(value("month")),
    day: Number(value("day")),
    weekday: WEEKDAY_INDEX[value("weekday")] ?? 0,
    hour: Number(value("hour")),
    minute: Number(value("minute"))
  };
}

function timeZoneOffsetMs(date: Date, timeZone: string): number {
  const parts = zonedParts(date, timeZone);
  return Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute) - Math.floor(date.getTime() / 60_000) * 60_000;
}

function zonedDateTimeToDate(parts: Pick<ZonedParts, "year" | "month" | "day">, minuteOfDay: number, timeZone: string): Date {
  const utcGuess = Date.UTC(parts.year, parts.month - 1, parts.day, Math.floor(minuteOfDay / 60), minuteOfDay % 60);
  const first = utcGuess - timeZoneOffsetMs(new Date(utcGuess), timeZone);
  return new Date(utcGuess - timeZoneOffsetMs(new Date(first), timeZone));
}

function addCalendarDays(parts: Pick<ZonedParts, "year" | "month" | "day">, count: number) {
  const next = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + count));
  return { year: next.getUTCFullYear(), month: next.getUTCMonth() + 1, day: next.getUTCDate() };
}

function isWeekday(day: number): boolean {
  return day >= 1 && day <= 5;
}

export type MarketSessionState = {
  isOpen: boolean;
  nextAction: "open" | "close";
  nextAt: Date;
  localTime: string;
};

export function getMarketSessionState(definition: MarketSessionDefinition, now: Date): MarketSessionState {
  const current = zonedParts(now, definition.timeZone);
  const minuteOfDay = current.hour * 60 + current.minute;

  if (isWeekday(current.weekday)) {
    const active = definition.sessions.find(
      (session) => minuteOfDay >= session.openMinute && minuteOfDay < session.closeMinute
    );
    if (active) {
      return {
        isOpen: true,
        nextAction: "close",
        nextAt: zonedDateTimeToDate(current, active.closeMinute, definition.timeZone),
        localTime: `${String(current.hour).padStart(2, "0")}:${String(current.minute).padStart(2, "0")}`
      };
    }

    const upcoming = definition.sessions.find((session) => minuteOfDay < session.openMinute);
    if (upcoming) {
      return {
        isOpen: false,
        nextAction: "open",
        nextAt: zonedDateTimeToDate(current, upcoming.openMinute, definition.timeZone),
        localTime: `${String(current.hour).padStart(2, "0")}:${String(current.minute).padStart(2, "0")}`
      };
    }
  }

  for (let offset = 1; offset <= 7; offset += 1) {
    const calendarDate = addCalendarDays(current, offset);
    const weekday = new Date(Date.UTC(calendarDate.year, calendarDate.month - 1, calendarDate.day)).getUTCDay();
    if (!isWeekday(weekday)) continue;
    return {
      isOpen: false,
      nextAction: "open",
      nextAt: zonedDateTimeToDate(calendarDate, definition.sessions[0]?.openMinute ?? 0, definition.timeZone),
      localTime: `${String(current.hour).padStart(2, "0")}:${String(current.minute).padStart(2, "0")}`
    };
  }

  return { isOpen: false, nextAction: "open", nextAt: now, localTime: "--:--" };
}

export function formatSessionCountdown(nextAt: Date, now: Date): string {
  const seconds = Math.max(0, Math.floor((nextAt.getTime() - now.getTime()) / 1000));
  const days = Math.floor(seconds / 86_400);
  const hours = Math.floor((seconds % 86_400) / 3_600);
  const minutes = Math.floor((seconds % 3_600) / 60);
  const remainingSeconds = seconds % 60;
  return days > 0
    ? `${days}d ${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`
    : `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(remainingSeconds).padStart(2, "0")}`;
}
