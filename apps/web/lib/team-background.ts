// Team background + org location helpers. Pure domain logic; DB access stays
// in API routes under withRls (this org only — never cross-tenant reads).

export type TeamBackgroundProfile = {
  mission: string | null;
  history: string | null;
  demographics: string | null;
  achievements: string[];
  studentCount: number | null;
  mentorCount: number | null;
  foundedYear: number | null;
};

export type OrgLocationBlurb = {
  city: string | null;
  stateProv: string | null;
  description: string | null;
  orgName: string | null;
  teamNumber: number | null;
};

export type TeamBackgroundView = {
  orgId: string;
  role: string;
  canEdit: boolean;
  org: OrgLocationBlurb;
  profile: TeamBackgroundProfile;
  updatedAt: string | null;
};

export function emptyBackgroundProfile(): TeamBackgroundProfile {
  return {
    mission: null,
    history: null,
    demographics: null,
    achievements: [],
    studentCount: null,
    mentorCount: null,
    foundedYear: null,
  };
}

export function formatOrgLocation(city: string | null, stateProv: string | null): string | null {
  const c = city?.trim() || "";
  const s = stateProv?.trim() || "";
  if (c && s) return `${c}, ${s}`;
  if (c) return c;
  if (s) return s;
  return null;
}

export function coerceAchievementList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.slice(0, 300))
    .slice(0, 24);
}

export function parseAchievementsInput(value: unknown): string[] {
  if (Array.isArray(value)) return coerceAchievementList(value);
  if (typeof value === "string") return coerceAchievementList(value.split(/\r?\n/));
  return [];
}

function trimOrNull(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, max);
}

function intOrNull(value: unknown, min: number, max: number): number | null {
  if (value == null || value === "") return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  const rounded = Math.round(n);
  if (rounded < min || rounded > max) return null;
  return rounded;
}

export type BackgroundSaveInput = {
  mission: string | null;
  history: string | null;
  demographics: string | null;
  achievements: string[];
  studentCount: number | null;
  mentorCount: number | null;
  foundedYear: number | null;
  city: string | null;
  stateProv: string | null;
  description: string | null;
};

/** Validate and normalize a save payload from Team settings / onboarding. */
export function parseBackgroundSave(body: Record<string, unknown>): BackgroundSaveInput {
  return {
    mission: trimOrNull(body.mission, 2000),
    history: trimOrNull(body.history, 8000),
    demographics: trimOrNull(body.demographics, 4000),
    achievements: parseAchievementsInput(body.achievements),
    studentCount: intOrNull(body.studentCount, 0, 10000),
    mentorCount: intOrNull(body.mentorCount, 0, 10000),
    foundedYear: intOrNull(body.foundedYear, 1992, 3000),
    city: trimOrNull(body.city, 120),
    stateProv: trimOrNull(body.stateProv, 80),
    description: trimOrNull(body.description, 2000),
  };
}

/**
 * Build a "who we are" seed for sponsorship one-pagers / grant drafts from
 * THIS org's background + onboarding location/description only.
 */
export function buildWhoWeAreSeed(
  org: OrgLocationBlurb,
  profile: TeamBackgroundProfile,
): string | null {
  const parts: string[] = [];
  const handle =
    org.teamNumber != null
      ? `FRC Team ${org.teamNumber}${org.orgName ? ` (${org.orgName})` : ""}`
      : org.orgName?.trim() || null;
  const location = formatOrgLocation(org.city, org.stateProv);

  if (handle) {
    parts.push(
      location
        ? `${handle} is a FIRST Robotics Competition team based in ${location}.`
        : `${handle} is a FIRST Robotics Competition team.`,
    );
  } else if (location) {
    parts.push(`We are a FIRST Robotics Competition team based in ${location}.`);
  }

  const description = org.description?.trim();
  if (description) parts.push(description);

  const mission = profile.mission?.trim();
  if (mission) parts.push(mission);

  const history = profile.history?.trim();
  if (history) parts.push(history);

  const demoBits: string[] = [];
  if (profile.studentCount != null) demoBits.push(`${profile.studentCount} students`);
  if (profile.mentorCount != null) demoBits.push(`${profile.mentorCount} mentors`);
  if (profile.foundedYear != null) demoBits.push(`competing since ${profile.foundedYear}`);
  if (demoBits.length) parts.push(`Our program includes ${demoBits.join(", ")}.`);

  const demographics = profile.demographics?.trim();
  if (demographics) parts.push(demographics);

  const highlights = profile.achievements.map((a) => a.trim()).filter(Boolean).slice(0, 5);
  if (highlights.length === 1) parts.push(`Recent highlight: ${highlights[0]}.`);
  else if (highlights.length > 1) {
    const last = highlights[highlights.length - 1];
    parts.push(`Recent highlights include ${highlights.slice(0, -1).join(", ")}, and ${last}.`);
  }

  const text = parts.join(" ").replace(/\s+/g, " ").trim();
  // Require more than a bare team handle — need location, description, or background facts.
  const hasSubstance = Boolean(
    location ||
      description ||
      mission ||
      history ||
      demoBits.length ||
      demographics ||
      highlights.length,
  );
  return hasSubstance && text.length >= 20 ? text.slice(0, 4000) : null;
}

export function preferMission(
  backgroundMission: string | null | undefined,
  orgDescription: string | null | undefined,
  writerMission: string | null | undefined,
): string | null {
  return backgroundMission?.trim() || orgDescription?.trim() || writerMission?.trim() || null;
}

export function preferRegion(
  writerRegion: string | null | undefined,
  city: string | null | undefined,
  stateProv: string | null | undefined,
): string | null {
  const explicit = writerRegion?.trim();
  if (explicit) return explicit;
  return formatOrgLocation(city ?? null, stateProv ?? null);
}

export function preferAchievements(
  background: string[] | null | undefined,
  writer: string[] | null | undefined,
): string[] {
  const fromBackground = coerceAchievementList(background ?? []);
  if (fromBackground.length) return fromBackground;
  return coerceAchievementList(writer ?? []);
}

export function isAdminRole(role: string | null | undefined): boolean {
  return role === "owner" || role === "admin";
}
