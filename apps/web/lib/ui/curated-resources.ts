/**
 * Curated canonical FREE community resources, by topic.
 *
 * WHY THIS EXISTS
 * ---------------
 * docs/COMMUNITY_DEMAND_RND.md is emphatic on two points:
 *
 *   - "CAD curriculum or training content. FRCDesign.org is free, canonical, and adored
 *     ('the single best course someone has made for FRC'); Onshape ships assignment tracking.
 *     Link it, track member progress against it, never author competing lessons."
 *   - UI fix #7: "Replace blank-page empty states with curated canonical free resources
 *     (FRCDesign.org for CAD training, Everybot for rookie strategy, LearnFRC for programming)
 *     — it converts thin pages into the aggregation value the community actually wants and
 *     reads as human-curated rather than AI slop."
 *
 * So this module is a POINTER LIST, not a content library. Vantage does not compete with
 * free canonical FRC material; it aggregates it and gets out of the way. Nothing here is
 * model-generated, and nothing here is a Vantage page.
 *
 * Pure module: no DB, no network, no Date.now(). Colocated tests cover the invariants
 * (https everywhere, unique ids, unique URLs, non-empty descriptions, every topic covered).
 */

export type ResourceTopic =
  | "rookie"
  | "cad"
  | "programming"
  | "strategy"
  | "scouting"
  | "business"
  | "season-ops";

export type ResourceAudience =
  | "rookie-team"
  | "students"
  | "mentors"
  | "business-team"
  | "everyone";

export type CuratedResource = {
  /** Stable id — referenced by roadmap tasks and empty states. */
  id: string;
  title: string;
  url: string;
  /** One sentence saying what it is and why we send you there. Never marketing copy. */
  oneLine: string;
  topic: ResourceTopic;
  /**
   * Other topics this belongs under. Everybot is strategy AND the first thing a rookie
   * should read, so it should surface in both places without a duplicate row.
   */
  secondaryTopics?: ResourceTopic[];
  audience: ResourceAudience;
  /** Who maintains it, so a mentor can judge the source before clicking. */
  maintainer: string;
};

/** Hosts this registry is allowed to point at. Enforced by test. */
export const ALLOWED_RESOURCE_HOSTS = [
  "www.firstinspires.org",
  "docs.wpilib.org",
  "www.frcdesign.org",
  "www.onshape.com",
  "www.mkcad.app",
  "learnfrc.com",
  "www.robonauts118.com",
  "www.openalliance.io",
  "www.chiefdelphi.com",
  "www.reddit.com",
  "www.thebluealliance.com",
  "www.statbotics.io",
] as const;

export const RESOURCE_FRESHNESS_NOTE =
  "These are other people's free resources, linked not copied. FIRST reorganises its site between seasons — if a link is dead, report it and we will re-curate it rather than write a replacement.";

/**
 * The registry. Ordered within each topic by "what a stuck person should open first".
 */
export const CURATED_RESOURCES: CuratedResource[] = [
  // --- Season operations: FIRST's own published material ---
  {
    id: "frc-game-manual",
    title: "FRC Game Manual & Q&A system",
    url: "https://www.firstinspires.org/resource-library/frc/competition-manual-qa-system",
    oneLine:
      "The rulebook, the weekly Team Updates that amend it, and the official Q&A — the only authority on what is legal this season.",
    topic: "season-ops",
    secondaryTopics: ["rookie", "strategy"],
    audience: "everyone",
    maintainer: "FIRST",
  },
  {
    id: "frc-team-management",
    title: "FRC Team Management Resources",
    url: "https://www.firstinspires.org/robotics/frc/team-management-resources",
    oneLine:
      "FIRST's own hub for registration, team roster and STIMS, event selection, and the season checklist every lead mentor is expected to work through.",
    topic: "season-ops",
    secondaryTopics: ["rookie"],
    audience: "mentors",
    maintainer: "FIRST",
  },
  {
    id: "frc-kickoff",
    title: "FRC Kickoff",
    url: "https://www.firstinspires.org/robotics/frc/kickoff",
    oneLine:
      "Where the season's game reveal, kickoff broadcast, and the first wave of official season materials are published.",
    topic: "season-ops",
    secondaryTopics: ["rookie"],
    audience: "everyone",
    maintainer: "FIRST",
  },
  {
    id: "frc-playing-field",
    title: "FRC Playing Field & official drawings",
    url: "https://www.firstinspires.org/robotics/frc/playing-field",
    oneLine:
      "Official field drawings and low-cost field-element build guides — build to these dimensions rather than to a photo of someone else's practice field.",
    topic: "season-ops",
    secondaryTopics: ["strategy"],
    audience: "students",
    maintainer: "FIRST",
  },
  {
    id: "first-team-event-search",
    title: "FIRST Team & Event Search",
    url: "https://www.firstinspires.org/team-event-search",
    oneLine:
      "Look up any team's registration and event list — how you confirm your own registration went through and find veteran teams near you to ask for help.",
    topic: "season-ops",
    secondaryTopics: ["rookie"],
    audience: "mentors",
    maintainer: "FIRST",
  },

  // --- Rookie survival ---
  {
    id: "reddit-frc",
    title: "r/FRC",
    url: "https://www.reddit.com/r/FRC/",
    oneLine:
      "Where rookie teams ask the questions they are embarrassed to ask, and get answered — specific personal asks get real replies here.",
    topic: "rookie",
    secondaryTopics: ["strategy"],
    audience: "rookie-team",
    maintainer: "the FRC community",
  },

  // --- Strategy ---
  {
    id: "everybot",
    title: "Everybot (FRC 118)",
    url: "https://www.robonauts118.com/everybot",
    oneLine:
      "A free, fully-documented robot design published every season that any team can build with basic tools — the single best answer to 'what should a rookie team actually build?'.",
    topic: "strategy",
    secondaryTopics: ["rookie"],
    audience: "rookie-team",
    maintainer: "FRC 118 Robonauts",
  },
  {
    id: "open-alliance",
    title: "The Open Alliance",
    url: "https://www.openalliance.io/",
    oneLine:
      "Teams that publish their real build-season decisions, CAD, and code as they happen — the closest thing to shadowing a good team through a season.",
    topic: "strategy",
    secondaryTopics: ["cad", "programming"],
    audience: "everyone",
    maintainer: "participating FRC teams",
  },
  {
    id: "chief-delphi",
    title: "Chief Delphi",
    url: "https://www.chiefdelphi.com/",
    oneLine:
      "The community's forum, and the place a specific, well-written question gets expert answers within hours — worth searching before you build anything.",
    topic: "strategy",
    secondaryTopics: ["rookie", "cad", "programming", "business"],
    audience: "everyone",
    maintainer: "the FRC community",
  },

  // --- CAD ---
  {
    id: "frcdesign",
    title: "FRCDesign.org",
    url: "https://www.frcdesign.org/",
    oneLine:
      "The free, structured Onshape-based FRC design course the community calls the best course anyone has made for teaching an FRC topic — start here instead of any in-app lesson.",
    topic: "cad",
    secondaryTopics: ["rookie"],
    audience: "students",
    maintainer: "the FRCDesign.org team",
  },
  {
    id: "onshape-first",
    title: "Onshape for FIRST",
    url: "https://www.onshape.com/en/education/first-robotics",
    oneLine:
      "Free professional CAD for FIRST teams, plus Onshape's own courses and class/assignment tracking for teaching a CAD subteam.",
    topic: "cad",
    audience: "mentors",
    maintainer: "Onshape (PTC)",
  },
  {
    id: "mkcad",
    title: "MKCad",
    url: "https://www.mkcad.app/",
    oneLine:
      "A free Onshape parts library of COTS FRC components, so students model with the real gearbox instead of re-drawing it.",
    topic: "cad",
    audience: "students",
    maintainer: "FRC 8628 / community contributors",
  },

  // --- Programming ---
  {
    id: "wpilib-zero-to-robot",
    title: "WPILib Zero-to-Robot",
    url: "https://docs.wpilib.org/en/stable/docs/zero-to-robot/introduction.html",
    oneLine:
      "The official step-by-step path from an unopened control system to a robot that drives — the correct first week for any new programmer.",
    topic: "programming",
    secondaryTopics: ["rookie"],
    audience: "students",
    maintainer: "WPILib",
  },
  {
    id: "wpilib-docs",
    title: "WPILib documentation",
    url: "https://docs.wpilib.org/en/stable/",
    oneLine:
      "The authoritative, season-current software documentation for the FRC control system — trust it over any chatbot answer about deprecated classes.",
    topic: "programming",
    audience: "students",
    maintainer: "WPILib",
  },
  {
    id: "learnfrc",
    title: "LearnFRC",
    url: "https://learnfrc.com/",
    oneLine:
      "Free self-paced FRC programming lessons written for students who missed the lecture night, with team-wide progress tracking.",
    topic: "programming",
    secondaryTopics: ["rookie"],
    audience: "students",
    maintainer: "a student-run community project",
  },

  // --- Scouting ---
  {
    id: "the-blue-alliance",
    title: "The Blue Alliance",
    url: "https://www.thebluealliance.com/",
    oneLine:
      "Free match results, schedules, team histories, and match video for every event — the baseline data you should never re-key by hand.",
    topic: "scouting",
    secondaryTopics: ["strategy"],
    audience: "everyone",
    maintainer: "The Blue Alliance",
  },
  {
    id: "statbotics",
    title: "Statbotics",
    url: "https://www.statbotics.io/",
    oneLine:
      "Free EPA ratings and season-long team analytics — a scouting-free starting picture of any team before your own data exists.",
    topic: "scouting",
    secondaryTopics: ["strategy"],
    audience: "everyone",
    maintainer: "Statbotics",
  },

  // --- Business, funding, awards ---
  {
    id: "first-fundraising-toolkit",
    title: "FIRST Fundraising Toolkit",
    url: "https://www.firstinspires.org/resource-library/fundraising-toolkit",
    oneLine:
      "FIRST's own sponsor-letter templates, grant guidance, and fundraising playbook — the free version of the sponsor packet teams pass around.",
    topic: "business",
    secondaryTopics: ["rookie"],
    audience: "business-team",
    maintainer: "FIRST",
  },
  {
    id: "frc-awards",
    title: "FRC Awards",
    url: "https://www.firstinspires.org/robotics/frc/awards",
    oneLine:
      "What each award actually asks for, including Rookie All Star and the Impact Award — read the criteria before writing anything.",
    topic: "business",
    secondaryTopics: ["rookie"],
    audience: "business-team",
    maintainer: "FIRST",
  },
  {
    id: "first-resource-library",
    title: "FIRST Resource Library",
    url: "https://www.firstinspires.org/resource-library",
    oneLine:
      "Everything FIRST publishes for teams in one searchable place — safety material, brand assets, team handbooks, and season documents.",
    topic: "business",
    secondaryTopics: ["season-ops", "rookie"],
    audience: "mentors",
    maintainer: "FIRST",
  },
];

const BY_ID = new Map(CURATED_RESOURCES.map((entry) => [entry.id, entry]));

export function resourceById(id: string): CuratedResource | undefined {
  return BY_ID.get(id);
}

/**
 * Resources for a topic, best-first. Primary-topic entries come before entries that
 * merely list the topic as secondary, so "cad" leads with FRCDesign.org rather than
 * with Chief Delphi.
 */
export function resourcesFor(topic: ResourceTopic, limit?: number): CuratedResource[] {
  const primary = CURATED_RESOURCES.filter((entry) => entry.topic === topic);
  const secondary = CURATED_RESOURCES.filter(
    (entry) => entry.topic !== topic && (entry.secondaryTopics ?? []).includes(topic),
  );
  const ordered = [...primary, ...secondary];
  return typeof limit === "number" ? ordered.slice(0, Math.max(0, limit)) : ordered;
}

export type ResourceLink = { label: string; url: string };

/**
 * A {label, url} pair for a registry entry, so other modules (the season roadmap)
 * cite canonical resources without duplicating URLs. Throws on an unknown id: a
 * dangling reference should fail the build, not ship a dead link.
 */
export function resourceLink(id: string): ResourceLink {
  const entry = BY_ID.get(id);
  if (!entry) throw new Error(`Unknown curated resource: ${id}`);
  return { label: entry.title, url: entry.url };
}

/** All topics that have at least one entry, in registry order. */
export function resourceTopics(): ResourceTopic[] {
  const seen: ResourceTopic[] = [];
  for (const entry of CURATED_RESOURCES) {
    for (const topic of [entry.topic, ...(entry.secondaryTopics ?? [])]) {
      if (!seen.includes(topic)) seen.push(topic);
    }
  }
  return seen;
}
