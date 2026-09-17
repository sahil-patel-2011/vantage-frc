/**
 * Keys for events a team adds itself.
 *
 * Offseason competitions — GRITS in Georgia, and its equivalents everywhere else
 * — are not in The Blue Alliance, so a team standing at one has nothing to point
 * Vantage at. These rows live in the same table as TBA events so that scouting,
 * schedule, intel and strategy treat them identically, which makes the key
 * format load-bearing: it has to be impossible for a team-made key to collide
 * with a real TBA key, now or after any future sync.
 *
 * TBA keys are a four-digit year followed by lowercase alphanumerics, with no
 * separators: `2026gagai`. Ours carry a literal `custom-` segment and hyphens,
 * so the two sets cannot overlap. The org fingerprint keeps two teams that both
 * run an event called "Grits" from colliding on a primary key.
 */

/** Matches exactly what the database policy on events_ref will accept. */
export const CUSTOM_EVENT_KEY_PATTERN = /^[0-9]{4}custom-[a-z0-9]{8}-[a-z0-9-]{1,40}$/;

export const MAX_CUSTOM_EVENT_NAME = 80;
const MAX_SLUG = 40;

/** True for an event this team created, false for anything synced from TBA. */
export function isCustomEventKey(eventKey: string): boolean {
  return CUSTOM_EVENT_KEY_PATTERN.test(eventKey);
}

/**
 * The org's first eight hex digits, which is plenty to separate the handful of
 * teams who will ever name an event the same thing, and short enough that the
 * key stays readable in a URL bar.
 */
function orgFingerprint(orgId: string): string {
  const hex = orgId.replace(/-/g, "").toLowerCase();
  if (!/^[0-9a-f]{32}$/.test(hex)) {
    throw new Error("orgId must be a uuid");
  }
  return hex.slice(0, 8);
}

/** A name reduced to the key-safe middle of a URL: "GRITS 2026!" → "grits-2026". */
export function slugifyEventName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, MAX_SLUG)
    // Trimming to a length can leave a trailing hyphen, which the pattern above
    // rejects. Trim again rather than letting a 41-character name fail.
    .replace(/-+$/g, "");
}

export type CustomEventDraft = {
  name: string;
  year: number;
  startDate?: string | null;
  endDate?: string | null;
  city?: string | null;
  stateProv?: string | null;
  country?: string | null;
};

export type CustomEventProblem =
  | "name-required"
  | "name-too-long"
  | "name-unusable"
  | "year-invalid"
  | "dates-reversed"
  | "date-invalid";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function isRealDate(value: string): boolean {
  if (!ISO_DATE.test(value)) return false;
  // Date.parse accepts "2026-02-31" and quietly rolls it into March. Round-trip
  // it so a typo in the pit is caught here rather than showing up as a schedule
  // that starts on the wrong day.
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

/** Everything wrong with a draft, so the form can say all of it at once. */
export function validateCustomEvent(draft: CustomEventDraft): CustomEventProblem[] {
  const problems: CustomEventProblem[] = [];
  const name = draft.name?.trim() ?? "";
  if (!name) problems.push("name-required");
  else if (name.length > MAX_CUSTOM_EVENT_NAME) problems.push("name-too-long");
  else if (!slugifyEventName(name)) problems.push("name-unusable");

  if (!Number.isInteger(draft.year) || draft.year < 1992 || draft.year > 2100) {
    problems.push("year-invalid");
  }

  const start = draft.startDate?.trim() || null;
  const end = draft.endDate?.trim() || null;
  if ((start && !isRealDate(start)) || (end && !isRealDate(end))) {
    problems.push("date-invalid");
  } else if (start && end && start > end) {
    problems.push("dates-reversed");
  }

  return problems;
}

/** What to show a person for each problem. No codes leak to the screen. */
export function customEventProblemCopy(problem: CustomEventProblem): string {
  switch (problem) {
    case "name-required":
      return "Give the event a name.";
    case "name-too-long":
      return `Keep the name under ${MAX_CUSTOM_EVENT_NAME} characters.`;
    case "name-unusable":
      return "The name needs at least one letter or number.";
    case "year-invalid":
      return "Pick a real season year.";
    case "date-invalid":
      return "Dates need to be real calendar dates, as YYYY-MM-DD.";
    case "dates-reversed":
      return "The event cannot end before it starts.";
  }
}

/**
 * The key for a drafted event. Throws on an invalid draft rather than minting a
 * key the database will refuse — a caller that skipped validation should find
 * out here and not as a constraint violation three layers down.
 */
export function customEventKey(orgId: string, draft: CustomEventDraft): string {
  const problems = validateCustomEvent(draft);
  if (problems.length) {
    throw new Error(problems.map(customEventProblemCopy).join(" "));
  }
  const key = `${draft.year}custom-${orgFingerprint(orgId)}-${slugifyEventName(draft.name)}`;
  if (!CUSTOM_EVENT_KEY_PATTERN.test(key)) {
    throw new Error("Could not build a usable key from that name.");
  }
  return key;
}
