/** Personal vs team prompt injection. Never put DOB, names, or contact details in team context. */

const EMAIL = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const PHONE = /\b(?:\+?1[-.\s]?)?(?:\(?\d{3}\)?[-.\s]?)\d{3}[-.\s]?\d{4}\b/g;
const HANDLE = /(^|[^\w])@[A-Za-z0-9_]{2,32}\b/g;

export function ageYearsFromDob(dobIso: string | null | undefined, now = new Date()): number | null {
  if (!dobIso) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(dobIso.trim());
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const birth = Date.UTC(year, month - 1, day);
  if (Number.isNaN(birth)) return null;
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  if (birth > today) return null;
  let age = now.getUTCFullYear() - year;
  const hadBirthday =
    now.getUTCMonth() + 1 > month || (now.getUTCMonth() + 1 === month && now.getUTCDate() >= day);
  if (!hadBirthday) age -= 1;
  if (age < 8 || age > 100) return null;
  return age;
}

/** Pitch explanations to the student without exposing the birthday. */
export function ageBandLabel(age: number | null): string | null {
  if (age == null) return null;
  if (age < 13) return "younger student (under 13 — keep language extra clear)";
  if (age <= 14) return "middle-school / early high-school student";
  if (age <= 18) return "high-school FRC student";
  if (age <= 22) return "college-age mentor or student";
  return "adult mentor";
}

export function stripPersonalIdentifiers(text: string): string {
  return text
    .replace(EMAIL, "[email removed]")
    .replace(PHONE, "[phone removed]")
    .replace(HANDLE, "$1[handle removed]")
    .replace(/\s+/g, " ")
    .trim();
}

export function parseTeamBraindump(value: unknown, max = 4_000): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.length > max) throw new Error(`Team notes must be ${max} characters or fewer.`);
  return trimmed;
}

export type PersonalPromptFacts = {
  ageYears: number | null;
  ageBand: string | null;
  teamRole: string | null;
  crewRole: string | null;
  roleDescription: string | null;
  teamBraindump: string | null;
  primaryFocus: string | null;
};

export function buildPersonalPromptBlock(facts: PersonalPromptFacts): string | null {
  const lines: string[] = [];
  if (facts.ageBand) {
    const ageBit = facts.ageYears != null ? ` (~${facts.ageYears})` : "";
    lines.push(`Audience: ${facts.ageBand}${ageBit}. Match explanation depth to that audience.`);
  }
  if (facts.teamRole) lines.push(`Role on the team: ${facts.teamRole}.`);
  if (facts.crewRole) lines.push(`Crew: ${facts.crewRole}.`);
  if (facts.roleDescription) lines.push(`How they help: ${facts.roleDescription}.`);
  if (facts.primaryFocus) lines.push(`They asked Vantage to prioritize: ${facts.primaryFocus}.`);
  if (facts.teamBraindump) lines.push(`Their private team dump (not for other members): ${facts.teamBraindump}`);
  if (!lines.length) return null;
  return ["Member personalization (private — do not repeat as facts about teammates):", ...lines].join("\n");
}

export function buildShareableTeamNote(input: {
  crewRole: string | null;
  braindump: string;
}): string | null {
  const cleaned = stripPersonalIdentifiers(input.braindump);
  if (cleaned.length < 12) return null;
  const crew = input.crewRole?.trim() || "team";
  return `Shared ${crew} context from a teammate (no personal identifiers): ${cleaned}`;
}
