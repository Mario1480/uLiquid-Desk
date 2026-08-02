export type IcsEvent = {
  uid: string;
  summary: string;
  description?: string;
  url?: string;
  start: string;
  timezone?: string;
  timeConfidence: "exact" | "date_only";
};

function parseIcsDate(value: string, timezone?: string): { iso: string; confidence: "exact" | "date_only" } | null {
  const raw = value.trim();
  const compactDate = raw.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (compactDate) {
    return {
      iso: new Date(Date.UTC(Number(compactDate[1]), Number(compactDate[2]) - 1, Number(compactDate[3]))).toISOString(),
      confidence: "date_only"
    };
  }
  const compactDateTime = raw.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z?)$/);
  if (!compactDateTime) return null;
  const components = {
    year: Number(compactDateTime[1]),
    month: Number(compactDateTime[2]),
    day: Number(compactDateTime[3]),
    hour: Number(compactDateTime[4]),
    minute: Number(compactDateTime[5]),
    second: Number(compactDateTime[6])
  };
  if (compactDateTime[7] === "Z" || !timezone || timezone.toUpperCase() === "UTC") {
    return {
      iso: new Date(Date.UTC(components.year, components.month - 1, components.day, components.hour, components.minute, components.second)).toISOString(),
      confidence: "exact"
    };
  }
  return { iso: zonedLocalTimeToUtc(components, timezone).toISOString(), confidence: "exact" };
}

export function zonedLocalTimeToUtc(
  components: { year: number; month: number; day: number; hour: number; minute: number; second?: number },
  timezone: string
): Date {
  const desired = Date.UTC(
    components.year,
    components.month - 1,
    components.day,
    components.hour,
    components.minute,
    components.second ?? 0
  );
  let guess = desired;
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23"
  });
  for (let iteration = 0; iteration < 3; iteration += 1) {
    const parts = Object.fromEntries(
      formatter.formatToParts(new Date(guess))
        .filter((part) => part.type !== "literal")
        .map((part) => [part.type, Number(part.value)])
    );
    const represented = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
    const delta = desired - represented;
    guess += delta;
    if (delta === 0) break;
  }
  return new Date(guess);
}

function unescapeIcs(value: string): string {
  return value
    .replace(/\\n/gi, " ")
    .replace(/\\,/g, ",")
    .replace(/\\;/g, ";")
    .replace(/\\\\/g, "\\")
    .trim();
}

export function parseIcsCalendar(ics: string, maxEvents = 1000): IcsEvent[] {
  const unfolded = String(ics ?? "").replace(/\r?\n[ \t]/g, "");
  if (unfolded.length > 3_000_000) throw new Error("calendar_ics_too_large");
  const blocks = [...unfolded.matchAll(/BEGIN:VEVENT\r?\n([\s\S]*?)\r?\nEND:VEVENT/gi)].slice(0, maxEvents);
  const events: IcsEvent[] = [];
  for (const match of blocks) {
    const fields = new Map<string, Array<{ params: string; value: string }>>();
    for (const line of (match[1] ?? "").split(/\r?\n/)) {
      const separator = line.indexOf(":");
      if (separator < 1) continue;
      const left = line.slice(0, separator);
      const value = line.slice(separator + 1);
      const [name, ...paramParts] = left.split(";");
      const key = name.toUpperCase();
      const current = fields.get(key) ?? [];
      current.push({ params: paramParts.join(";"), value });
      fields.set(key, current);
    }
    const uid = unescapeIcs(fields.get("UID")?.[0]?.value ?? "");
    const summary = unescapeIcs(fields.get("SUMMARY")?.[0]?.value ?? "");
    const startField = fields.get("DTSTART")?.[0];
    if (!uid || !summary || !startField) continue;
    const timezone = startField.params.match(/(?:^|;)TZID=([^;]+)/i)?.[1];
    const parsedStart = parseIcsDate(startField.value, timezone);
    if (!parsedStart) continue;
    const description = unescapeIcs(fields.get("DESCRIPTION")?.[0]?.value ?? "");
    const url = unescapeIcs(fields.get("URL")?.[0]?.value ?? "");
    events.push({
      uid,
      summary,
      ...(description ? { description } : {}),
      ...(url ? { url } : {}),
      start: parsedStart.iso,
      ...(timezone ? { timezone } : {}),
      timeConfidence: parsedStart.confidence
    });
  }
  return events;
}
