/**
 * Onboarding checklists ↔ product deep links.
 * Keeps first-run / getting-started / dashboard setup steps pointed at
 * subteam calendars, knowledge wiki, event logistics, and kickoff summary
 * without inventing demo progress.
 */

export type OnboardingLink = { href: string; label: string };

export type OnboardingChecklistStep = {
  key: string;
  label: string;
  detail: string;
  done: boolean;
  href: string;
};

export type OnboardingSurface = "calendar" | "knowledge" | "logistics" | "kickoff" | "getting_started";

/** Stable hrefs shared with role-onboarding track templates (CD #28). */
export const ONBOARDING_PATH_HREFS = {
  gettingStarted: "/team/getting-started",
  calendar: "/team/calendar",
  knowledge: "/team/knowledge",
  logistics: "/logistics",
  kickoff: "/kickoff",
} as const;

function withOrgPath(path: string, orgId: string): string {
  const join = path.includes("?") ? "&" : "?";
  return `${path}${join}orgId=${encodeURIComponent(orgId)}`;
}

/** Hub strip shared by getting-started and surface page headers. */
export function onboardingHubLinks(orgId: string): OnboardingLink[] {
  return [
    { href: withOrgPath(ONBOARDING_PATH_HREFS.gettingStarted, orgId), label: "Getting started" },
    { href: withOrgPath(ONBOARDING_PATH_HREFS.calendar, orgId), label: "Subteam calendar" },
    { href: withOrgPath(ONBOARDING_PATH_HREFS.knowledge, orgId), label: "Knowledge wiki" },
    { href: withOrgPath(ONBOARDING_PATH_HREFS.logistics, orgId), label: "Logistics" },
    { href: withOrgPath(ONBOARDING_PATH_HREFS.kickoff, orgId), label: "Kickoff summary" },
  ];
}

/** Cross-links on a surface so new members can hop the onboarding path. */
export function surfaceOnboardingLinks(surface: OnboardingSurface, orgId: string): OnboardingLink[] {
  const all = onboardingHubLinks(orgId);
  const selfHref = (() => {
    switch (surface) {
      case "calendar":
        return withOrgPath(ONBOARDING_PATH_HREFS.calendar, orgId);
      case "knowledge":
        return withOrgPath(ONBOARDING_PATH_HREFS.knowledge, orgId);
      case "logistics":
        return withOrgPath(ONBOARDING_PATH_HREFS.logistics, orgId);
      case "kickoff":
        return withOrgPath(ONBOARDING_PATH_HREFS.kickoff, orgId);
      case "getting_started":
        return withOrgPath(ONBOARDING_PATH_HREFS.gettingStarted, orgId);
    }
  })();
  return all.filter((link) => link.href !== selfHref);
}

export type OnboardingSignals = {
  orgId: string;
  hasEventContext: boolean;
  tbaConfigured: boolean;
  hasScoutingSchemas: boolean;
  hasAiProvider: boolean;
  joinedSubteam: boolean;
  hasKnowledge: boolean;
  hasLogistics: boolean;
  kickoffReady: boolean;
  /** True when TBA schedule has an upcoming match for the team. */
  knowsNextMatch?: boolean;
};

/**
 * Full setup checklist: platform gates + season path
 * (subteam calendar → knowledge wiki → logistics → kickoff summary).
 */
export function buildOnboardingChecklistSteps(signals: OnboardingSignals): OnboardingChecklistStep[] {
  const q = `?orgId=${encodeURIComponent(signals.orgId)}`;
  return [
    {
      key: "workspace",
      label: "Workspace",
      detail: "Team selected",
      done: true,
      href: `/workspace${q}`,
    },
    {
      key: "event",
      label: "Select event",
      detail: "Set the active competition context",
      done: signals.hasEventContext,
      href: `/command${q}`,
    },
    {
      key: "subteam",
      label: "Join a subteam calendar",
      detail: "Pick mechanical, software, or your build crew so practices show up",
      done: signals.joinedSubteam,
      href: `${ONBOARDING_PATH_HREFS.calendar}${q}`,
    },
    {
      key: "knowledge",
      label: "Read the knowledge wiki",
      detail: "Team robot, strategy, and conventions the AI already uses",
      done: signals.hasKnowledge,
      href: `${ONBOARDING_PATH_HREFS.knowledge}${q}`,
    },
    {
      key: "logistics",
      label: "Check event logistics",
      detail: "Lodging, travel notes, and day-of checklists",
      done: signals.hasLogistics,
      href: `${ONBOARDING_PATH_HREFS.logistics}${q}`,
    },
    {
      key: "kickoff",
      label: "Open kickoff summary",
      detail: "Scoring actions, design priorities, and CAD brief handoff",
      done: signals.kickoffReady,
      href: `${ONBOARDING_PATH_HREFS.kickoff}${q}`,
    },
    {
      key: "tba",
      label: "Sync TBA",
      detail: "Connect match and rank ingest",
      done: signals.tbaConfigured,
      href: `/team/data${q}`,
    },
    {
      key: "next_match",
      label: "Know your next match",
      detail: "Bumper color, start time, and travel cues on My Day",
      done: Boolean(signals.knowsNextMatch),
      href: `/my-day${q}`,
    },
    {
      key: "scouting",
      label: "Scout",
      detail: "Starter match and pit forms",
      done: signals.hasScoutingSchemas,
      href: `/scouting${q}`,
    },
    {
      key: "ai",
      label: "Metered AI",
      detail: "BYO provider for free-tier AI",
      done: signals.hasAiProvider,
      href: `/team${q}#custom-providers`,
    },
  ];
}

/** Season-only slice for role-based / home-strip paths. */
export function buildSeasonOnboardingSteps(input: {
  orgId: string;
  joinedSubteam: boolean;
  hasKnowledge: boolean;
  hasLogistics: boolean;
  kickoffReady: boolean;
}): OnboardingChecklistStep[] {
  return buildOnboardingChecklistSteps({
    orgId: input.orgId,
    hasEventContext: true,
    tbaConfigured: true,
    hasScoutingSchemas: true,
    hasAiProvider: true,
    joinedSubteam: input.joinedSubteam,
    hasKnowledge: input.hasKnowledge,
    hasLogistics: input.hasLogistics,
    kickoffReady: input.kickoffReady,
  }).filter((step) => ["subteam", "knowledge", "logistics", "kickoff"].includes(step.key));
}

/** Suggested links from a calendar event kind into the onboarding path. */
export function calendarOnboardingLinks(kind: string, orgId: string): OnboardingLink[] {
  const links: OnboardingLink[] = [
    { href: withOrgPath(ONBOARDING_PATH_HREFS.gettingStarted, orgId), label: "Onboarding checklist" },
  ];
  if (kind === "event" || kind === "meeting") {
    links.push({ href: withOrgPath(ONBOARDING_PATH_HREFS.logistics, orgId), label: "Event logistics" });
  }
  if (kind === "practice" || kind === "build" || kind === "meeting") {
    links.push({ href: withOrgPath(ONBOARDING_PATH_HREFS.knowledge, orgId), label: "Knowledge wiki" });
  }
  if (kind === "deadline" || kind === "meeting") {
    links.push({ href: withOrgPath(ONBOARDING_PATH_HREFS.kickoff, orgId), label: "Kickoff summary" });
  }
  return links;
}
