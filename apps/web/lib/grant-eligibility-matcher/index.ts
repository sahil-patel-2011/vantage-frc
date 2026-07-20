import type { CatalogGrant, GrantMatchOutcome, TeamEligibilityProfile } from "./types";

export * from "./types";

function regionMatches(profile: TeamEligibilityProfile, regions: string[]): boolean {
  const candidates = [profile.region, profile.country].filter((v): v is string => !!v).map((v) => v.toLowerCase());
  return regions.some((region) => candidates.includes(region.toLowerCase()));
}

function employerMatches(profile: TeamEligibilityProfile, employers: string[]): boolean {
  const owned = profile.mentorEmployers.map((e) => e.toLowerCase());
  return employers.some((employer) => owned.some((o) => o.includes(employer.toLowerCase()) || employer.toLowerCase().includes(o)));
}

/**
 * Evaluate one grant's structured eligibility rules against a team's recorded profile.
 * Every rule present in the grant contributes one weighted criterion; a grant with no rules
 * at all is treated as open to everyone. Missing team-profile data for a rule counts as unmet
 * (never assumed to pass) — this never fabricates eligibility.
 */
export function evaluateGrantEligibility(profile: TeamEligibilityProfile, grant: CatalogGrant): GrantMatchOutcome {
  const rules = grant.eligibilityRules;
  const matchedReasons: string[] = [];
  const unmetReasons: string[] = [];
  let criteria = 0;
  let met = 0;

  if (typeof rules.maxRookieYears === "number") {
    criteria += 1;
    if (profile.rookieYear == null) {
      unmetReasons.push("Rookie year not on file for this team");
    } else {
      const yearsActive = new Date().getUTCFullYear() - profile.rookieYear;
      if (yearsActive >= 0 && yearsActive <= rules.maxRookieYears) {
        met += 1;
        matchedReasons.push(`Rookie status: ${yearsActive} year(s) active (limit ${rules.maxRookieYears})`);
      } else {
        unmetReasons.push(`Requires ≤${rules.maxRookieYears} years active; team has ${Math.max(0, yearsActive)}`);
      }
    }
  }

  if (rules.regions && rules.regions.length > 0) {
    criteria += 1;
    if (!profile.region && !profile.country) {
      unmetReasons.push("Team region not on file");
    } else if (regionMatches(profile, rules.regions)) {
      met += 1;
      matchedReasons.push(`Region matches (${rules.regions.join(", ")})`);
    } else {
      unmetReasons.push(`Requires region: ${rules.regions.join(", ")}`);
    }
  }

  if (rules.mentorEmployers && rules.mentorEmployers.length > 0) {
    criteria += 1;
    if (profile.mentorEmployers.length === 0) {
      unmetReasons.push("No mentor employers on file");
    } else if (employerMatches(profile, rules.mentorEmployers)) {
      met += 1;
      matchedReasons.push("Mentor employer matches funder's list");
    } else {
      unmetReasons.push(`Requires a mentor employed by: ${rules.mentorEmployers.join(", ")}`);
    }
  }

  if (rules.requiresDemographicsFocus) {
    criteria += 1;
    if (profile.hasDemographicsFocus) {
      met += 1;
      matchedReasons.push("Team demographics narrative on file");
    } else {
      unmetReasons.push("Requires a recorded demographics/access narrative");
    }
  }

  if (typeof rules.minStudentCount === "number") {
    criteria += 1;
    if (profile.studentCount == null) {
      unmetReasons.push("Student count not on file");
    } else if (profile.studentCount >= rules.minStudentCount) {
      met += 1;
      matchedReasons.push(`Student count ${profile.studentCount} meets minimum ${rules.minStudentCount}`);
    } else {
      unmetReasons.push(`Requires ≥${rules.minStudentCount} students; team has ${profile.studentCount}`);
    }
  }

  if (typeof rules.minMentorCount === "number") {
    criteria += 1;
    if (profile.mentorCount == null) {
      unmetReasons.push("Mentor count not on file");
    } else if (profile.mentorCount >= rules.minMentorCount) {
      met += 1;
      matchedReasons.push(`Mentor count ${profile.mentorCount} meets minimum ${rules.minMentorCount}`);
    } else {
      unmetReasons.push(`Requires ≥${rules.minMentorCount} mentors; team has ${profile.mentorCount}`);
    }
  }

  if (criteria === 0) {
    return { grantId: grant.id, isEligible: true, score: 100, matchedReasons: ["Open eligibility — no restrictions on file"], unmetReasons: [] };
  }

  const score = Math.round((met / criteria) * 100);
  const isEligible = met === criteria;
  return { grantId: grant.id, isEligible, score, matchedReasons, unmetReasons };
}

/** Days from now until an ISO date, or null if there is no date to compute against. */
export function daysUntil(dateIso: string | null, now: Date = new Date()): number | null {
  if (!dateIso) return null;
  const target = new Date(`${dateIso}T00:00:00Z`);
  if (Number.isNaN(target.getTime())) return null;
  const startOfToday = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Math.round((target.getTime() - startOfToday) / (1000 * 60 * 60 * 24));
}
