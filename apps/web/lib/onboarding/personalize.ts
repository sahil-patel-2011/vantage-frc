/**
 * Role → product personalization. Pure and allowlisted: never invents
 * destinations, widgets, or metrics. Freebuff may reorder these four island
 * slots; anything off-catalog is dropped and this fallback wins.
 */

import {
  ISLAND_TAB_CATALOG,
  PRIMARY_TABS,
} from "../nav/product-nav";
import { defaultIslandHrefs, isValidIslandSelection } from "../nav/island-preferences";
import { parseStoredCrews, parseStoredRoles } from "./roles";
import type { OnboardingCrew, OnboardingFocus, OnboardingRole } from "./step-model";

const BUILD_CREW = new Set<OnboardingCrew>(["mechanical", "electrical", "programming", "cad"]);
const COMPETE_CREW = new Set<OnboardingCrew>(["scout", "driver", "operator", "pit"]);

const COMPETE = "/competition";
const SCOUT = "/competition?tab=scouting";
const BUILD = "/build";
const RUN_SEASON = "/team";

const CATALOG = new Set(ISLAND_TAB_CATALOG.map((item) => item.href));

export type RolePersonalization = {
  islandHrefs: string[];
  defaultHub: string;
  greetingHint: string;
  source: "roles";
};

export type PersonalizeInput = {
  teamRole?: string | string[] | null;
  crewRole?: string | string[] | null;
  primaryFocus?: OnboardingFocus | string | null;
};

const ROLE_LABEL: Record<OnboardingRole, string> = {
  student: "student",
  mentor: "mentor",
  coach: "coach",
  parent: "parent",
  other: "member",
};

const CREW_LABEL: Record<OnboardingCrew, string> = {
  scout: "scout",
  driver: "driver",
  operator: "operator",
  mechanical: "mechanical",
  electrical: "electrical",
  programming: "programming",
  cad: "CAD",
  pit: "pit",
  business: "business",
  other: "generalist",
};

function fillIsland(preferred: string[]): string[] {
  const slots: string[] = [];
  for (const href of preferred) {
    if (slots.length >= 4) break;
    if (!CATALOG.has(href) || slots.includes(href)) continue;
    slots.push(href);
  }
  for (const href of defaultIslandHrefs()) {
    if (slots.length >= 4) break;
    if (!slots.includes(href)) slots.push(href);
  }
  return slots.slice(0, 4);
}

function greetingHint(identities: OnboardingRole[], crews: OnboardingCrew[]): string {
  const crewNames = crews.filter((crew) => crew !== "other").map((crew) => CREW_LABEL[crew]);
  const roleNames = identities.map((role) => ROLE_LABEL[role]);
  if (crewNames.length && roleNames.length) {
    return `${roleNames.join(" + ")} · ${crewNames.join(" + ")}. Your island follows those jobs.`;
  }
  if (crewNames.length) {
    return `${crewNames.join(" + ")} — your workspaces are set around those jobs.`;
  }
  if (roleNames.length) {
    return `${roleNames.join(" + ")}. Pick the jobs you actually do to tighten this further.`;
  }
  return "Scout, Compete, Build, and Run season — change their order from the island.";
}

export function personalizeFromRoles(input: PersonalizeInput): RolePersonalization {
  const identities = parseStoredRoles(input.teamRole);
  const crews = parseStoredCrews(input.crewRole);
  const focus = String(input.primaryFocus ?? "").trim().toLowerCase();

  const wantsScout = crews.includes("scout");
  const wantsBuild = crews.some((crew) => BUILD_CREW.has(crew)) || focus === "build";
  const wantsCompete = crews.some((crew) => COMPETE_CREW.has(crew)) || focus === "competition";
  const wantsBusiness = crews.includes("business") || focus === "business";
  const adultLead =
    identities.some((role) => role === "mentor" || role === "coach") && crews.length === 0;
  const parentFollow = identities.includes("parent") && !wantsScout && !wantsBuild && !wantsCompete;

  const preferred: string[] = [];
  if (wantsScout) preferred.push(SCOUT);
  else if (wantsCompete) preferred.push(COMPETE);
  if (wantsBuild) preferred.push(BUILD);
  // Funding, sponsorships, logistics, and AI live under Run season and remain
  // role/funding-profile gated once a member arrives there.
  if (wantsBusiness || parentFollow) preferred.push(RUN_SEASON);
  preferred.push(RUN_SEASON);
  if (crews.length > 0 || identities.includes("student")) preferred.push(BUILD);
  if (adultLead) preferred.push(COMPETE, RUN_SEASON);
  if (!preferred.includes(COMPETE) && !preferred.includes(SCOUT)) preferred.push(COMPETE);
  preferred.push(SCOUT, BUILD, RUN_SEASON);

  const islandHrefs = fillIsland(preferred);
  return {
    islandHrefs,
    defaultHub: islandHrefs[0] ?? PRIMARY_TABS[0]?.href ?? COMPETE,
    greetingHint: greetingHint(identities, crews),
    source: "roles",
  };
}

/** Drop any model-proposed slot that is not in the island catalog. */
export function clampPersonalizedIsland(
  proposed: unknown,
  fallback: RolePersonalization,
): RolePersonalization {
  if (!isValidIslandSelection(proposed)) return fallback;
  return {
    ...fallback,
    islandHrefs: proposed,
    defaultHub: proposed[1] ?? fallback.defaultHub,
  };
}

export function clampGreetingHint(value: unknown, fallback: string): string {
  if (typeof value !== "string") return fallback;
  const trimmed = value.replace(/\s+/g, " ").trim();
  if (trimmed.length < 8 || trimmed.length > 160) return fallback;
  if (/\d{3,}/.test(trimmed)) return fallback;
  if (/demo|placeholder|lorem/i.test(trimmed)) return fallback;
  return trimmed;
}
