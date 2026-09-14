/**
 * Turn a Postgres integrity error into something a team can act on.
 *
 * 31 columns across 18 migrations carry `event_key ... REFERENCES events_ref`,
 * and nothing anywhere classified a 23503. So a team that opened a pick list (or
 * a match note, or a scouting assignment) for an event Vantage had not ingested
 * from official matches yet got the raw constraint text straight back:
 *
 *   insert or update on table "pick_lists" violates foreign key constraint
 *   "pick_lists_event_key_fkey"
 *
 * That is unreadable to a student in a pit, leaks the schema into an API
 * response, and — worst — hides the one thing they could actually do about it,
 * which is sync the event's reference data first.
 *
 * This maps the integrity errors that reach real users onto plain sentences and
 * leaves everything else alone.
 */

type PgErrorish = {
  code?: string;
  constraint?: string;
  table?: string;
  detail?: string;
  message?: string;
};

function asPgError(error: unknown): PgErrorish | null {
  if (!error || typeof error !== "object") return null;
  const candidate = error as PgErrorish;
  return typeof candidate.code === "string" ? candidate : null;
}

/** Postgres error codes that describe a caller-fixable data problem. */
const FOREIGN_KEY_VIOLATION = "23503";
const UNIQUE_VIOLATION = "23505";
const CHECK_VIOLATION = "23514";
const NOT_NULL_VIOLATION = "23502";

export type FriendlyDbError = {
  message: string;
  /** 409 for a duplicate, 422 for a value the caller can correct. */
  status: 409 | 422;
  /** Set when the fix is to ingest reference data for an event. */
  eventReferenceMissing?: boolean;
};

/**
 * Classify a Postgres error, or return null when it is not one of the
 * caller-fixable shapes (a genuine bug should keep failing loudly).
 */
export function classifyDbError(error: unknown): FriendlyDbError | null {
  const pg = asPgError(error);
  if (!pg) return null;

  if (pg.code === FOREIGN_KEY_VIOLATION) {
    const constraint = pg.constraint ?? "";
    const detail = pg.detail ?? "";
    if (/event_key/.test(constraint) || /\bevent_key\b/.test(detail)) {
      return {
        message:
          "That event is not in Vantage's reference data yet. Sync the official event under Team → Data, then try again.",
        status: 422,
        eventReferenceMissing: true,
      };
    }
    if (/team_key/.test(constraint) || /\bteam_key\b/.test(detail)) {
      return {
        message:
          "That team is not in Vantage's reference data yet. Sync the event's official teams under Team → Data, then try again.",
        status: 422,
      };
    }
    if (/match_key/.test(constraint) || /\bmatch_key\b/.test(detail)) {
      return {
        message:
          "That match is not in Vantage's reference data yet. Sync the event's official schedule under Team → Data, then try again.",
        status: 422,
      };
    }
    return {
      message: "That record points at something that no longer exists. Reload the page and try again.",
      status: 422,
    };
  }

  if (pg.code === UNIQUE_VIOLATION) {
    return { message: "That already exists — open the existing entry instead of adding a second one.", status: 409 };
  }

  if (pg.code === CHECK_VIOLATION) {
    return { message: "One of those values is outside the range this field allows.", status: 422 };
  }

  if (pg.code === NOT_NULL_VIOLATION) {
    return { message: "A required field was left empty.", status: 422 };
  }

  return null;
}

/**
 * Shared JSON failure for a data-write route: a readable message for the
 * integrity errors a user can fix, and the caller's own message otherwise.
 * Never returns a raw Postgres constraint string.
 */
export function failDbWrite(error: unknown, fallbackMessage: string, fallbackStatus = 400): Response {
  const friendly = classifyDbError(error);
  if (friendly) {
    return Response.json(
      {
        error: friendly.message,
        ...(friendly.eventReferenceMissing ? { code: "event_reference_missing" } : {}),
      },
      { status: friendly.status },
    );
  }
  const message = error instanceof Error ? error.message : fallbackMessage;
  if (message === "forbidden") return Response.json({ error: "Organization access denied" }, { status: 403 });
  return Response.json({ error: message }, { status: fallbackStatus });
}
