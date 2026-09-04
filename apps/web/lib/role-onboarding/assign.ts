import type { AssignInput, AssignedTrack, TrackSource } from "./types";

/** Subteam name keywords → track keys (fuzzy / substring, case-insensitive). */
export const SUBTEAM_KEYWORD_MAP: Array<{ trackKey: string; keywords: string[] }> = [
  {
    trackKey: "mechanical",
    keywords: ["mech", "mechanical", "fabricat", "machin", "chassis", "mechanism", "hardware", "build", "pit", "pit crew"],
  },
  {
    trackKey: "electrical",
    keywords: ["electr", "wiring", "wire", "pdh", "pneumatic", "controls hardware"],
  },
  {
    trackKey: "programming",
    keywords: ["program", "software", "code", "controls software", "firmware", "roborio"],
  },
  {
    trackKey: "cad",
    keywords: ["cad", "design", "onshape", "fusion", "solidworks", "modeling"],
  },
  {
    trackKey: "drive_team",
    keywords: ["drive", "driver", "operator", "human player", "drive team", "driveteam"],
  },
  {
    trackKey: "scouting",
    keywords: ["scout", "scouting", "strategy", "alliance", "stand scout"],
  },
  {
    trackKey: "business",
    keywords: ["business", "sponsor", "outreach", "media", "award", "fundraising", "finance"],
  },
  {
    trackKey: "safety",
    keywords: ["safety", "shop safety", "ehs"],
  },
];

const ROLE_TRACK: Record<string, string> = {
  student: "role_student",
  mentor: "role_mentor",
  coach: "role_coach",
  parent: "role_parent",
  other: "role_other",
};

const FOCUS_TRACK: Record<string, string> = {
  competition: "focus_competition",
  build: "focus_build",
  business: "focus_business",
  leadership: "focus_leadership",
};

function normalize(value: string): string {
  return value.trim().toLowerCase();
}

/** Match one subteam display name to zero or more specialty tracks. */
export function matchSubteamTracks(subteamName: string): string[] {
  const hay = normalize(subteamName);
  if (!hay) return [];
  const hits: string[] = [];
  for (const entry of SUBTEAM_KEYWORD_MAP) {
    if (entry.keywords.some((kw) => hay.includes(normalize(kw)))) {
      hits.push(entry.trackKey);
    }
  }
  return hits;
}

function pushUnique(
  out: AssignedTrack[],
  seen: Set<string>,
  trackKey: string,
  source: TrackSource,
  reason: string,
) {
  if (seen.has(trackKey)) return;
  seen.add(trackKey);
  out.push({ trackKey, source, reason });
}

/**
 * Auto-assign onboarding tracks from profile role/focus and calendar subteam names.
 * Always includes `welcome`. Order: welcome → role → focus → subteam specialties.
 */
export function assignOnboardingTracks(input: AssignInput): AssignedTrack[] {
  const out: AssignedTrack[] = [];
  const seen = new Set<string>();

  pushUnique(out, seen, "welcome", "welcome", "Everyone starts here");

  const roles = String(input.teamRole ?? "")
    .split(/[\s,|/]+/)
    .map(normalize)
    .filter(Boolean);
  for (const role of roles) {
    if (ROLE_TRACK[role]) {
      pushUnique(out, seen, ROLE_TRACK[role], "role", `From your team role (${role})`);
    }
  }

  const focus = input.primaryFocus ? normalize(input.primaryFocus) : "";
  if (focus && FOCUS_TRACK[focus]) {
    pushUnique(
      out,
      seen,
      FOCUS_TRACK[focus],
      "focus",
      `From your primary focus (${input.primaryFocus})`,
    );
  }

  for (const name of input.subteamNames ?? []) {
    for (const trackKey of matchSubteamTracks(name)) {
      pushUnique(out, seen, trackKey, "subteam", `Matched subteam "${name}"`);
    }
  }

  const crews = String(input.crewRole ?? "")
    .split(/[\s,|/]+/)
    .map((crew) => crew.trim())
    .filter(Boolean);
  for (const crew of crews) {
    for (const trackKey of matchSubteamTracks(crew.replaceAll("_", " "))) {
      pushUnique(out, seen, trackKey, "role", `From your crew role (${crew})`);
    }
  }

  if (input.roleDescription) {
    for (const trackKey of matchSubteamTracks(input.roleDescription)) {
      pushUnique(out, seen, trackKey, "role", "From how you described your role");
    }
  }

  return out;
}
