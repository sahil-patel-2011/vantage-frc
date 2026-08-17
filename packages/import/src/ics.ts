import { provenanceNow, type ImportDraft } from "./provenance";

export type ParsedIcsEvent = {
  uid: string;
  title: string;
  startsAt: string;
  endsAt: string | null;
  location: string;
  description: string;
};

function unfold(raw: string): string[] {
  const normalized = raw.replace(/\r\n/g, "\n").replace(/\n[ \t]/g, "");
  return normalized.split("\n").map((line) => line.trimEnd());
}

function unescapeIcs(value: string): string {
  return value
    .replace(/\\n/gi, "\n")
    .replace(/\\,/g, ",")
    .replace(/\\;/g, ";")
    .replace(/\\\\/g, "\\");
}

function parseIcsDate(value: string): string | null {
  const compact = value.replace(/Z$/i, "");
  const match = compact.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2}))?/);
  if (!match) return null;
  const [, year, month, day, hour = "00", minute = "00", second = "00"] = match;
  const iso = `${year}-${month}-${day}T${hour}:${minute}:${second}${value.endsWith("Z") ? "Z" : ""}`;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/** Parse VEVENT blocks from an ICS document. Never invents events. */
export function parseIcs(content: string, now: Date = new Date()): ParsedIcsEvent[] {
  const lines = unfold(content);
  const events: ParsedIcsEvent[] = [];
  let current: Record<string, string> | null = null;
  for (const line of lines) {
    if (line === "BEGIN:VEVENT") {
      current = {};
      continue;
    }
    if (line === "END:VEVENT") {
      if (current) {
        const startsAt = current.DTSTART ? parseIcsDate(current.DTSTART) : null;
        const title = unescapeIcs(current.SUMMARY ?? "").trim();
        if (startsAt && title) {
          events.push({
            uid: (current.UID ?? `${title}:${startsAt}`).trim(),
            title,
            startsAt,
            endsAt: current.DTEND ? parseIcsDate(current.DTEND) : null,
            location: unescapeIcs(current.LOCATION ?? "").trim(),
            description: unescapeIcs(current.DESCRIPTION ?? "").trim(),
          });
        }
      }
      current = null;
      continue;
    }
    if (!current) continue;
    const colon = line.indexOf(":");
    if (colon < 1) continue;
    const key = line.slice(0, colon).split(";")[0]!.toUpperCase();
    current[key] = line.slice(colon + 1);
  }
  void now;
  return events;
}

export function icsEventsToDrafts(events: ParsedIcsEvent[], sourceUrl?: string, now: Date = new Date()): ImportDraft[] {
  const provenance = provenanceNow("ics", sourceUrl ? { sourceUrl } : undefined, now);
  return events.map((event) => ({
    kind: "calendar" as const,
    title: event.title,
    body: event.description || undefined,
    startsAt: event.startsAt,
    endsAt: event.endsAt ?? undefined,
    payload: { uid: event.uid, location: event.location },
    provenance: { ...provenance, sourceId: event.uid },
  }));
}
