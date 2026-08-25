// Pure grant-calendar eligibility matching. No I/O, no Date.now() unless passed in.
//
// The design rule that matters here: UNKNOWN IS A FIRST-CLASS RESULT. When the team profile
// lacks the field a rule needs, the match says so by name ("we don't know your Title I
// status") instead of guessing eligible (raising false hope and wasting a mentor's evening)
// or ineligible (hiding money the team could have had).

import type {
  DeadlineUrgency,
  EligibilityReason,
  EligibilityVerdict,
  GrantCalendarMatch,
  GrantCalendarOpportunity,
  GrantEligibilityRules,
  OrgGrantProfile,
} from "./types";

const MS_PER_DAY = 86_400_000;

/** Parse a `YYYY-MM-DD` date column into a UTC-midnight timestamp. Returns null when unusable. */
export function parseIsoDate(value: string | null | undefined): number | null {
  if (!value) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value.trim());
  if (!match) return null;
  const time = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return Number.isFinite(time) ? time : null;
}

/** Whole days from `now` to `iso`, negative when `iso` is in the past. Null when undated. */
export function daysUntil(iso: string | null | undefined, now: Date): number | null {
  const target = parseIsoDate(iso);
  if (target === null) return null;
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Math.round((target - today) / MS_PER_DAY);
}

/**
 * Deadline urgency bands. `closing-3` / `closing-14` / `closing-30` line up with the alert
 * milestones so the chip a mentor sees matches the email they got.
 */
export function deadlineUrgency(input: {
  opensOn: string | null;
  closesOn: string | null;
  now: Date;
}): DeadlineUrgency {
  const untilClose = daysUntil(input.closesOn, input.now);
  const untilOpen = daysUntil(input.opensOn, input.now);
  if (untilClose !== null) {
    if (untilClose < 0) return "closed";
    if (untilClose <= 3) return "closing-3";
    if (untilClose <= 14) return "closing-14";
    if (untilClose <= 30) return "closing-30";
  }
  if (untilOpen !== null && untilOpen > 0) return "not-open-yet";
  if (untilClose === null && untilOpen === null) return "no-date";
  return "open";
}

export function urgencyLabel(urgency: DeadlineUrgency): string {
  switch (urgency) {
    case "closed":
      return "Closed";
    case "closing-3":
      return "Closes in 3 days or less";
    case "closing-14":
      return "Closes within 2 weeks";
    case "closing-30":
      return "Closes within a month";
    case "not-open-yet":
      return "Not open yet";
    case "no-date":
      return "No dates recorded";
    case "open":
      return "Open";
  }
}

/** Seasons since rookie year, rookie season counting as 1. Null when either input is missing. */
export function teamAgeSeasons(profile: OrgGrantProfile): number | null {
  if (profile.rookieYear == null || profile.seasonYear == null) return null;
  const age = profile.seasonYear - profile.rookieYear + 1;
  return Number.isFinite(age) ? age : null;
}

function normalizeRegion(value: string): string {
  return value.trim().toUpperCase();
}

function known(reason: EligibilityReason): EligibilityReason {
  return reason;
}

function unknownReason(
  rule: keyof GrantEligibilityRules,
  missingField: keyof OrgGrantProfile,
  detail: string,
): EligibilityReason {
  return { rule, verdict: "unknown", detail, missingField };
}

function evaluateRules(
  rules: GrantEligibilityRules,
  profile: OrgGrantProfile,
): EligibilityReason[] {
  const reasons: EligibilityReason[] = [];
  const age = teamAgeSeasons(profile);

  if (rules.rookieOnly === true) {
    if (age === null) {
      reasons.push(
        unknownReason(
          "rookieOnly",
          profile.rookieYear == null ? "rookieYear" : "seasonYear",
          "Rookie teams only — we don't know your rookie year, so we can't tell.",
        ),
      );
    } else if (age <= 1) {
      reasons.push(known({ rule: "rookieOnly", verdict: "eligible", detail: "Rookie season — this grant is rookie-only." }));
    } else {
      reasons.push(
        known({
          rule: "rookieOnly",
          verdict: "ineligible",
          detail: `Rookie teams only — you are in season ${age}.`,
        }),
      );
    }
  }

  if (typeof rules.teamAgeMax === "number") {
    if (age === null) {
      reasons.push(
        unknownReason(
          "teamAgeMax",
          profile.rookieYear == null ? "rookieYear" : "seasonYear",
          `Open to teams in their first ${rules.teamAgeMax} season(s) — we don't know your rookie year.`,
        ),
      );
    } else if (age <= rules.teamAgeMax) {
      reasons.push(
        known({
          rule: "teamAgeMax",
          verdict: "eligible",
          detail: `Season ${age} of a ${rules.teamAgeMax}-season window.`,
        }),
      );
    } else {
      reasons.push(
        known({
          rule: "teamAgeMax",
          verdict: "ineligible",
          detail: `Limited to teams within ${rules.teamAgeMax} season(s); you are in season ${age}.`,
        }),
      );
    }
  }

  if (typeof rules.teamAgeMin === "number") {
    if (age === null) {
      reasons.push(
        unknownReason(
          "teamAgeMin",
          profile.rookieYear == null ? "rookieYear" : "seasonYear",
          `Requires at least ${rules.teamAgeMin} season(s) of history — we don't know your rookie year.`,
        ),
      );
    } else if (age >= rules.teamAgeMin) {
      reasons.push(
        known({
          rule: "teamAgeMin",
          verdict: "eligible",
          detail: `Season ${age} meets the ${rules.teamAgeMin}-season minimum.`,
        }),
      );
    } else {
      reasons.push(
        known({
          rule: "teamAgeMin",
          verdict: "ineligible",
          detail: `Requires at least ${rules.teamAgeMin} season(s); you are in season ${age}.`,
        }),
      );
    }
  }

  if (typeof rules.titleI === "boolean") {
    if (profile.titleI === null) {
      reasons.push(
        unknownReason(
          "titleI",
          "titleI",
          rules.titleI
            ? "Requires a Title I school — we don't know your Title I status."
            : "Excludes Title I schools — we don't know your Title I status.",
        ),
      );
    } else if (profile.titleI === rules.titleI) {
      reasons.push(
        known({
          rule: "titleI",
          verdict: "eligible",
          detail: rules.titleI ? "Your school is recorded as Title I." : "Your school is recorded as non-Title I.",
        }),
      );
    } else {
      reasons.push(
        known({
          rule: "titleI",
          verdict: "ineligible",
          detail: rules.titleI
            ? "Requires a Title I school; yours is recorded as non-Title I."
            : "Excludes Title I schools; yours is recorded as Title I.",
        }),
      );
    }
  }

  if (typeof rules.nonprofit501c3 === "boolean") {
    if (profile.nonprofit501c3 === null) {
      reasons.push(
        unknownReason(
          "nonprofit501c3",
          "nonprofit501c3",
          "Requires your own 501(c)(3) — we don't know whether your team holds one.",
        ),
      );
    } else if (profile.nonprofit501c3 === rules.nonprofit501c3) {
      reasons.push(
        known({
          rule: "nonprofit501c3",
          verdict: "eligible",
          detail: rules.nonprofit501c3
            ? "Your team is recorded as holding its own 501(c)(3)."
            : "Recorded 501(c)(3) status matches this grant.",
        }),
      );
    } else {
      reasons.push(
        known({
          rule: "nonprofit501c3",
          verdict: "ineligible",
          detail: rules.nonprofit501c3
            ? "Requires your own 501(c)(3); your team is recorded as not having one."
            : "Open only to teams without their own 501(c)(3).",
        }),
      );
    }
  }

  if (Array.isArray(rules.region) && rules.region.length > 0) {
    const allowed = rules.region.map(normalizeRegion).filter(Boolean);
    const mine = [profile.stateProv, profile.country]
      .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
      .map(normalizeRegion);
    if (allowed.length === 0) {
      // Rule present but empty — treat as no constraint rather than a fake verdict.
    } else if (mine.length === 0) {
      reasons.push(
        unknownReason(
          "region",
          "stateProv",
          `Limited to ${allowed.join(", ")} — we don't know your team's state or country.`,
        ),
      );
    } else if (mine.some((value) => allowed.includes(value))) {
      reasons.push(
        known({ rule: "region", verdict: "eligible", detail: `Your region (${mine[0]}) is on the funder's list.` }),
      );
    } else {
      reasons.push(
        known({
          rule: "region",
          verdict: "ineligible",
          detail: `Limited to ${allowed.join(", ")}; your team is recorded in ${mine[0]}.`,
        }),
      );
    }
  }

  if (typeof rules.minStudentCount === "number") {
    if (profile.studentCount === null) {
      reasons.push(
        unknownReason(
          "minStudentCount",
          "studentCount",
          `Requires ${rules.minStudentCount}+ students — we don't have a student count on file.`,
        ),
      );
    } else if (profile.studentCount >= rules.minStudentCount) {
      reasons.push(
        known({
          rule: "minStudentCount",
          verdict: "eligible",
          detail: `${profile.studentCount} students meets the ${rules.minStudentCount} minimum.`,
        }),
      );
    } else {
      reasons.push(
        known({
          rule: "minStudentCount",
          verdict: "ineligible",
          detail: `Requires ${rules.minStudentCount}+ students; ${profile.studentCount} recorded.`,
        }),
      );
    }
  }

  if (typeof rules.minMentorCount === "number") {
    if (profile.mentorCount === null) {
      reasons.push(
        unknownReason(
          "minMentorCount",
          "mentorCount",
          `Requires ${rules.minMentorCount}+ mentors — we don't have a mentor count on file.`,
        ),
      );
    } else if (profile.mentorCount >= rules.minMentorCount) {
      reasons.push(
        known({
          rule: "minMentorCount",
          verdict: "eligible",
          detail: `${profile.mentorCount} mentors meets the ${rules.minMentorCount} minimum.`,
        }),
      );
    } else {
      reasons.push(
        known({
          rule: "minMentorCount",
          verdict: "ineligible",
          detail: `Requires ${rules.minMentorCount}+ mentors; ${profile.mentorCount} recorded.`,
        }),
      );
    }
  }

  return reasons;
}

function rollUp(reasons: EligibilityReason[]): true | false | "unknown" {
  if (reasons.some((reason) => reason.verdict === "ineligible")) return false;
  if (reasons.some((reason) => reason.verdict === "unknown")) return "unknown";
  return true;
}

const URGENCY_RANK: Record<DeadlineUrgency, number> = {
  "closing-3": 0,
  "closing-14": 1,
  "closing-30": 2,
  open: 3,
  "not-open-yet": 4,
  "no-date": 5,
  closed: 6,
};

const ELIGIBILITY_RANK: Record<string, number> = { true: 0, unknown: 1, false: 2 };

/** Evaluate one opportunity against the team profile. */
export function matchOpportunity(
  profile: OrgGrantProfile,
  opportunity: GrantCalendarOpportunity,
  now: Date,
): GrantCalendarMatch {
  const rules = opportunity.eligibility ?? {};
  const reasons = evaluateRules(rules, profile);
  const eligible = rollUp(reasons);
  const missingFields = Array.from(
    new Set(
      reasons
        .filter((reason) => reason.verdict === "unknown" && reason.missingField)
        .map((reason) => reason.missingField as keyof OrgGrantProfile),
    ),
  );

  if (reasons.length === 0) {
    reasons.push({
      rule: "none",
      verdict: "eligible" as EligibilityVerdict,
      detail: "The funder records no eligibility restrictions in our calendar.",
    });
  }

  return {
    opportunity,
    eligible,
    reasons,
    missingFields,
    urgency: deadlineUrgency({
      opensOn: opportunity.opensOn,
      closesOn: opportunity.closesOn,
      now,
    }),
    daysUntilClose: daysUntil(opportunity.closesOn, now),
    daysUntilOpen: daysUntil(opportunity.opensOn, now),
  };
}

/**
 * Rank the calendar the way a mentor reads it: soonest real deadline first, then eligible
 * before unknown before ineligible, then by funder name so the order is stable.
 * Inactive rows are dropped; closed rows sort last but are NOT hidden (a closed grant is
 * next season's calendar entry).
 */
export function matchOpportunities(
  profile: OrgGrantProfile,
  opportunities: GrantCalendarOpportunity[],
  now: Date = new Date(),
): GrantCalendarMatch[] {
  return opportunities
    .filter((opportunity) => opportunity.isActive)
    .map((opportunity) => matchOpportunity(profile, opportunity, now))
    .sort((a, b) => {
      const urgency = URGENCY_RANK[a.urgency] - URGENCY_RANK[b.urgency];
      if (urgency !== 0) return urgency;
      const eligibility =
        (ELIGIBILITY_RANK[String(a.eligible)] ?? 0) -
        (ELIGIBILITY_RANK[String(b.eligible)] ?? 0);
      if (eligibility !== 0) return eligibility;
      const closeA = a.daysUntilClose ?? Number.MAX_SAFE_INTEGER;
      const closeB = b.daysUntilClose ?? Number.MAX_SAFE_INTEGER;
      if (closeA !== closeB) return closeA - closeB;
      return a.opportunity.name.localeCompare(b.opportunity.name);
    });
}

/**
 * The tightest 30/14/3 milestone band a close date currently sits in, or null when the grant
 * is undated, still more than 30 days out, or already closed.
 *
 * Deliberately a BAND, not an exact day match: a skipped cron run must not silently swallow
 * a mentor's only warning. The per-(org, grant, member, milestone, close-date) ledger row is
 * what makes it fire once — see `grant_calendar_alert_events` in migration 0458.
 */
export function alertMilestoneForClose(
  closesOn: string | null,
  now: Date,
): 30 | 14 | 3 | null {
  const days = daysUntil(closesOn, now);
  if (days === null || days < 0) return null;
  if (days <= 3) return 3;
  if (days <= 14) return 14;
  if (days <= 30) return 30;
  return null;
}
