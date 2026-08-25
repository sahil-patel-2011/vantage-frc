// Forgot-to-sign-out sweep — pure, deterministic, unit-tested.
//
// The failure mode every FRC shop kiosk hits: a student scans in at 6pm, leaves
// at 9pm without scanning out, and the session is still open at noon the next
// day. Two wrong answers exist. Crediting the full 18 hours fabricates
// attendance. Deleting the row erases a real sign-in. So this sweep does the
// third thing: it CLOSES the session with a capped, clearly-labelled credit and
// flags the row (hour_logs.auto_closed) so a mentor sees it and corrects the
// real departure time by hand. Nothing here invents hours a student earned.

/** A session is presumed forgotten once it has been open this long. */
export const DEFAULT_AUTO_CLOSE_AFTER_HOURS = 12;

/** Hours an auto-closed session may credit before mentor review. */
export const DEFAULT_AUTO_CLOSE_CREDIT_HOURS = 4;

/**
 * hour_logs has `CHECK (clock_out > clock_in)`, so even a zero-credit policy
 * has to leave a sliver. One minute reads as "essentially nothing credited".
 */
export const MIN_CREDIT_HOURS = 1 / 60;

export const MAX_AUTO_CLOSE_AFTER_HOURS = 168;
export const MAX_AUTO_CLOSE_CREDIT_HOURS = 24;

const round2 = (value: number) => Math.round(value * 100) / 100;

/**
 * "Missing" and "explicitly zero" are different policies, and `Number(null)` is
 * 0 — so a team with no hour_policies row would otherwise inherit a
 * credit-nothing sweep instead of the documented 4h default. Absent values must
 * reach the caller as null, never as a number.
 */
function readNumber(value: unknown): number | null {
  if (value == null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export type OpenSession = {
  id: string;
  userId: string;
  userName: string | null;
  clockIn: string;
};

export type AutoClosePolicy = {
  /** Open longer than this (hours) and the session is swept. */
  afterHours: number;
  /** Maximum hours an auto-closed session may credit. */
  creditHours: number;
};

export type AutoCloseClosure = {
  id: string;
  userId: string;
  userName: string | null;
  clockIn: string;
  /** Timestamp to write to hour_logs.clock_out. */
  clockOut: string;
  /** How long the session had actually been open when the sweep ran. */
  openHours: number;
  /** Hours actually credited — always <= policy.creditHours. */
  creditedHours: number;
  /** Hours withheld pending mentor review (openHours - creditedHours). */
  withheldHours: number;
  /** Text written to hour_logs.auto_closed_reason. */
  reason: string;
};

export type AutoClosePlan = {
  closures: AutoCloseClosure[];
  /** Sessions left alone because they are still inside the cutoff. */
  keptOpen: number;
  policy: AutoClosePolicy;
};

/** Clamp a stored/submitted policy into the range the migration allows. */
export function normalizeAutoClosePolicy(input: {
  afterHours?: number | null;
  creditHours?: number | null;
}): AutoClosePolicy {
  const rawAfter = readNumber(input.afterHours);
  const rawCredit = readNumber(input.creditHours);
  const afterHours = rawAfter != null && rawAfter > 0
    ? Math.min(rawAfter, MAX_AUTO_CLOSE_AFTER_HOURS)
    : DEFAULT_AUTO_CLOSE_AFTER_HOURS;
  const creditHours = rawCredit != null && rawCredit >= 0
    ? Math.min(rawCredit, MAX_AUTO_CLOSE_CREDIT_HOURS)
    : DEFAULT_AUTO_CLOSE_CREDIT_HOURS;
  return { afterHours: round2(afterHours), creditHours: round2(creditHours) };
}

export function autoCloseReason(input: {
  openHours: number;
  creditedHours: number;
  afterHours: number;
}): string {
  return (
    `Forgot to sign out: still open ${input.openHours}h after clock-in ` +
    `(sweep cutoff ${input.afterHours}h). Credited ${input.creditedHours}h — ` +
    `capped, not the full elapsed time. A mentor must set the real clock-out.`
  );
}

/**
 * Plan the sweep. Pure: same inputs always produce the same closures, in a
 * stable order (oldest clock-in first), and it never mutates its arguments.
 */
export function planAutoClose(input: {
  sessions: OpenSession[];
  policy: AutoClosePolicy;
  now: number;
}): AutoClosePlan {
  const policy = normalizeAutoClosePolicy({
    afterHours: input.policy.afterHours,
    creditHours: input.policy.creditHours,
  });
  const cutoffMs = policy.afterHours * 3_600_000;

  const closures: AutoCloseClosure[] = [];
  let keptOpen = 0;

  const ordered = [...input.sessions].sort(
    (a, b) => a.clockIn.localeCompare(b.clockIn) || a.id.localeCompare(b.id),
  );

  for (const session of ordered) {
    const start = new Date(session.clockIn).getTime();
    // An unparseable or future clock-in is a data problem, not a forgotten
    // sign-out; leave it for a human rather than closing something we can't read.
    if (!Number.isFinite(start) || start > input.now) {
      keptOpen += 1;
      continue;
    }
    const openMs = input.now - start;
    if (openMs < cutoffMs) {
      keptOpen += 1;
      continue;
    }
    const openHours = round2(openMs / 3_600_000);
    const creditedHours = round2(
      Math.max(MIN_CREDIT_HOURS, Math.min(openHours, policy.creditHours)),
    );
    closures.push({
      id: session.id,
      userId: session.userId,
      userName: session.userName,
      clockIn: session.clockIn,
      clockOut: new Date(start + creditedHours * 3_600_000).toISOString(),
      openHours,
      creditedHours,
      withheldHours: round2(Math.max(0, openHours - creditedHours)),
      reason: autoCloseReason({ openHours, creditedHours, afterHours: policy.afterHours }),
    });
  }

  return { closures, keptOpen, policy };
}

/** One-line summary for the kiosk banner and the API response. */
export function describeAutoClosePlan(plan: AutoClosePlan): string {
  if (!plan.closures.length) {
    return `No forgotten sessions — nothing has been open longer than ${plan.policy.afterHours}h.`;
  }
  const withheld = round2(plan.closures.reduce((sum, row) => sum + row.withheldHours, 0));
  const names = plan.closures
    .map((row) => row.userName?.trim() || "a member")
    .slice(0, 3)
    .join(", ");
  const more = plan.closures.length > 3 ? ` +${plan.closures.length - 3} more` : "";
  return (
    `Flagged ${plan.closures.length} forgotten session${plan.closures.length === 1 ? "" : "s"} ` +
    `(${names}${more}). ${withheld}h withheld for mentor review.`
  );
}
