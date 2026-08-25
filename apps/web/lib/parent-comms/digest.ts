/**
 * Weekly parent digest builder. Pure and honest: when the period holds no real
 * events and no logistics note, it returns null and NOTHING is sent — an empty
 * week never becomes a fabricated email.
 *
 * One-way by design (no reply path). The body carries only event logistics:
 * title / when / where. Never student names, never roster or contact data.
 */

export type DigestEvent = {
  title: string;
  /** ISO instant. */
  startsAt: string;
  /** ISO instant or null for open-ended events. */
  endsAt: string | null;
  location: string;
};

export type ParentDigestInput = {
  orgName: string;
  teamNumber?: number | null;
  events: DigestEvent[];
  /** Optional mentor-authored logistics note included verbatim. */
  logisticsNotes?: string | null;
  /** Inclusive period start, YYYY-MM-DD. */
  periodStart: string;
  /** Inclusive period end, YYYY-MM-DD. */
  periodEnd: string;
  /** IANA zone used purely for human formatting; defaults to UTC. */
  timeZone?: string;
};

export type ParentDigest = { subject: string; text: string; html: string };

export type ParentDigestPeriod = {
  /** Inclusive, YYYY-MM-DD. */
  periodStart: string;
  /** Inclusive, YYYY-MM-DD (start + 6 days — a 7-day window). */
  periodEnd: string;
};

export const DIGEST_WINDOW_DAYS = 7;

/** The 7-day digest period beginning on `now`'s UTC date. */
export function digestPeriod(now: Date): ParentDigestPeriod {
  const periodStart = now.toISOString().slice(0, 10);
  const periodEnd = new Date(now.getTime() + (DIGEST_WINDOW_DAYS - 1) * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
  return { periodStart, periodEnd };
}

const MAX_EVENTS = 40;

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function safeZone(timeZone: string | undefined): string {
  if (!timeZone) return "UTC";
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return timeZone;
  } catch {
    return "UTC";
  }
}

function dayLabel(iso: string, timeZone: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "short",
    day: "numeric",
    timeZone,
  }).format(date);
}

function timeLabel(iso: string, timeZone: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone,
  }).format(date);
}

function eventLine(event: DigestEvent, timeZone: string): string {
  const start = timeLabel(event.startsAt, timeZone);
  const end = event.endsAt ? timeLabel(event.endsAt, timeZone) : "";
  const when = end ? `${start}–${end}` : start;
  const where = event.location.trim() ? ` @ ${event.location.trim()}` : "";
  return `${when} — ${event.title.trim()}${where}`;
}

function periodLabel(periodStart: string, periodEnd: string): string {
  return `${periodStart} to ${periodEnd}`;
}

/**
 * Build the digest, or return null when there is nothing real to send.
 * Events with an unparsable start are dropped rather than rendered wrong;
 * if that leaves nothing (and no note), the result is null.
 */
export function buildParentDigest(input: ParentDigestInput): ParentDigest | null {
  const timeZone = safeZone(input.timeZone);
  const note = (input.logisticsNotes ?? "").trim();
  const events = input.events
    .filter((event) => event.title.trim() && !Number.isNaN(new Date(event.startsAt).getTime()))
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt))
    .slice(0, MAX_EVENTS);

  if (events.length === 0 && !note) return null;

  const teamLabel =
    input.teamNumber != null ? `${input.orgName} (Team ${input.teamNumber})` : input.orgName;
  const subject =
    events.length > 0
      ? `${teamLabel}: ${events.length} upcoming ${events.length === 1 ? "event" : "events"} this week`
      : `${teamLabel}: team update`;

  // Group by local day.
  const groups: Array<{ day: string; lines: string[]; htmlLines: string[] }> = [];
  for (const event of events) {
    const day = dayLabel(event.startsAt, timeZone);
    const line = eventLine(event, timeZone);
    const last = groups[groups.length - 1];
    if (last && last.day === day) {
      last.lines.push(line);
      last.htmlLines.push(escapeHtml(line));
    } else {
      groups.push({ day, lines: [line], htmlLines: [escapeHtml(line)] });
    }
  }

  const textParts: string[] = [
    `${teamLabel} — parent update for ${periodLabel(input.periodStart, input.periodEnd)}.`,
  ];
  if (note) textParts.push(note);
  for (const group of groups) {
    textParts.push(`${group.day}\n${group.lines.map((line) => `  • ${line}`).join("\n")}`);
  }
  textParts.push(
    "This is a one-way update from the team — replies to this address are not monitored.",
  );
  const text = textParts.join("\n\n");

  const htmlParts: string[] = [
    `<p><strong>${escapeHtml(teamLabel)}</strong> — parent update for ${escapeHtml(
      periodLabel(input.periodStart, input.periodEnd),
    )}.</p>`,
  ];
  if (note) htmlParts.push(`<p>${escapeHtml(note)}</p>`);
  for (const group of groups) {
    htmlParts.push(
      `<p style="margin-bottom:4px"><strong>${escapeHtml(group.day)}</strong></p>` +
        `<ul style="margin-top:0">${group.htmlLines.map((line) => `<li>${line}</li>`).join("")}</ul>`,
    );
  }
  htmlParts.push(
    `<p style="font-size:12px;color:#666">This is a one-way update from the team — replies to this address are not monitored.</p>`,
  );
  const html = htmlParts.join("\n");

  return { subject, text, html };
}
