import { hubHref } from "../nav/hubs";
import { withOrgHref } from "../nav/product-nav";

/** Soft-UI related surfaces for Sketch-to-Brief (never DEMO brief metrics). */
export const SKETCH_TO_BRIEF_RELATED_LINKS = [
  { id: "kickoff", label: "Kickoff", kind: "build" as const, tab: "kickoff" },
  { id: "cad", label: "CAD", kind: "build" as const, tab: "cad" },
  { id: "rule-impact", label: "Rule Impact", kind: "build" as const, tab: "rule-impact" },
  { id: "subsystems", label: "Subsystems", kind: "path" as const, path: "/subsystems" },
] as const;

export type SketchToBriefRelatedId = (typeof SKETCH_TO_BRIEF_RELATED_LINKS)[number]["id"];

export type SketchToBriefRelatedLink = {
  id: SketchToBriefRelatedId;
  label: string;
  href: string;
};

/** Focused Soft-UI strip — Kickoff / CAD first. */
export const SKETCH_TO_BRIEF_RELATED_INCLUDE: SketchToBriefRelatedId[] = ["kickoff", "cad"];

/**
 * Soft-UI cross-links from Sketch-to-Brief → Kickoff / CAD.
 * Build with hubHref / withOrgHref — never broken JSX href templates.
 */
export function sketchToBriefRelatedLinks(
  orgId?: string | null,
  options?: { active?: SketchToBriefRelatedId; include?: SketchToBriefRelatedId[] },
): SketchToBriefRelatedLink[] {
  const include = options?.include ? new Set(options.include) : null;
  return SKETCH_TO_BRIEF_RELATED_LINKS.filter((link) => {
    if (link.id === options?.active) return false;
    if (include && !include.has(link.id)) return false;
    return true;
  }).map((link) => {
    if (link.kind === "build") {
      return { id: link.id, label: link.label, href: hubHref("/build", link.tab, orgId) };
    }
    return { id: link.id, label: link.label, href: withOrgHref(link.path, orgId) };
  });
}

export type SketchToBriefShellKind = "loading" | "error" | "setup" | "empty" | "ready";

export type SketchToBriefNextAction = {
  id: string;
  label: string;
  detail: string;
  href: string;
  primary?: boolean;
};

export type SketchToBriefEmptyCopy = {
  kind: SketchToBriefShellKind;
  badge?: string;
  title: string;
  description: string;
};

/** Real sketch / brief / rule-flag counts only — never invent DEMO brief totals. */
export function formatSketchToBriefMetric(value: unknown, loaded: boolean): string {
  if (!loaded) return "…";
  const n = Number(value ?? 0);
  if (!Number.isFinite(n) || n < 0) return "0";
  return Math.floor(n).toLocaleString();
}

/** Classify Sketch-to-Brief Soft-UI shell — never invents DEMO brief metrics. */
export function classifySketchToBriefShell(input: {
  loading: boolean;
  fetchFailed?: boolean;
  status?: "setup_required" | "live" | null;
  orgId?: string | null;
  sketchCount?: number;
}): SketchToBriefShellKind {
  if (input.loading) return "loading";
  if (input.fetchFailed) return "error";
  if (!input.orgId || input.status === "setup_required") return "setup";
  if ((input.sketchCount ?? 0) === 0) return "empty";
  return "ready";
}

/** Soft-UI empty / setup / error copy — never DEMO brief metrics. */
export function sketchToBriefShellCopy(kind: SketchToBriefShellKind): SketchToBriefEmptyCopy {
  switch (kind) {
    case "loading":
      return {
        kind,
        title: "Loading Sketch-to-Brief…",
        description:
          "Checking workspace membership and logged kickoff sketches.",
      };
    case "error":
      return {
        kind,
        badge: "Unavailable",
        title: "Could not load Sketch-to-Brief",
        description:
          "A network or server issue blocked sketches. Retry, or open Kickoff / CAD while it reloads.",
      };
    case "setup":
      return {
        kind,
        badge: "Setup required",
        title: "Select a team workspace",
        description:
          "Sketch-to-Brief is org-scoped. Pick a workspace before logging whiteboard sketches — nothing is pre-seeded.",
      };
    case "empty":
      return {
        kind,
        badge: "No sketches yet",
        title: "Log your first kickoff sketch",
        description:
          "CAD briefs stay blank until you transcribe a real whiteboard sketch. Cross-check Kickoff and CAD.",
      };
    default:
      return {
        kind: "ready",
        title: "Kickoff sketches & CAD briefs",
        description:
          "Briefs and rule flags use only transcribed notes plus your team's Kickoff rule notes and design priorities.",
      };
  }
}

/**
 * Soft-UI next actions for Sketch-to-Brief empty/setup shells.
 * Points at Kickoff / CAD — never invents DEMO brief metrics.
 */
export function sketchToBriefNextActions(input: {
  orgId?: string | null;
  shell: SketchToBriefShellKind;
  sketchCount?: number;
  briefCount?: number;
  draftCount?: number;
  ruleFlagCount?: number;
}): SketchToBriefNextAction[] {
  const orgId = input.orgId ?? null;
  const sketchCount = input.sketchCount ?? 0;
  const briefCount = input.briefCount ?? 0;
  const draftCount = input.draftCount ?? 0;
  const ruleFlagCount = input.ruleFlagCount ?? 0;

  if (!orgId || input.shell === "setup") {
    if (!orgId) {
      return [
        {
          id: "workspace",
          label: "Select workspace",
          detail: "Sketches are org-scoped — pick a team before logging whiteboard notes.",
          href: "/workspace",
          primary: true,
        },
        {
          id: "kickoff",
          label: "Open Kickoff",
          detail: "Rule notes stay blank until answered.",
          href: hubHref("/build", "kickoff", null),
        },
        {
          id: "cad",
          label: "Open CAD",
          detail: "Mechanism geometry stays blank until connected.",
          href: hubHref("/build", "cad", null),
        },
      ];
    }
    return [
      {
        id: "workspace",
        label: "Open Workspace",
        detail: "Finish membership setup so Sketch-to-Brief can resolve your organization.",
        href: withOrgHref("/workspace", orgId),
        primary: true,
      },
      {
        id: "kickoff",
        label: "Open Kickoff",
        detail: "Capture rule notes and design priorities that ground CAD briefs.",
        href: hubHref("/build", "kickoff", orgId),
      },
      {
        id: "cad",
        label: "Open CAD",
        detail: "Confirm which mechanisms you plan to model after the first brief.",
        href: hubHref("/build", "cad", orgId),
      },
    ];
  }

  if (input.shell === "error") {
    return [
      {
        id: "retry",
        label: "Retry Sketch-to-Brief",
        detail: "Reload real sketches — nothing is invented while this fails.",
        href: withOrgHref("/sketch-to-brief", orgId),
        primary: true,
      },
      {
        id: "kickoff",
        label: "Open Kickoff",
        detail: "Rule notes stay available while sketches reload.",
        href: hubHref("/build", "kickoff", orgId),
      },
      {
        id: "cad",
        label: "Open CAD",
        detail: "Mechanism review stays available while sketches reload.",
        href: hubHref("/build", "cad", orgId),
      },
    ];
  }

  if (input.shell === "empty" || sketchCount === 0) {
    return [
      {
        id: "log-sketch",
        label: "Log a kickoff sketch",
        detail: "Transcribe the whiteboard — briefs stay blank until then.",
        href: "#sketch-to-brief-log-sketch",
        primary: true,
      },
      {
        id: "kickoff",
        label: "Cross-check Kickoff",
        detail: "Answered rule notes and priorities ground the first CAD brief.",
        href: hubHref("/build", "kickoff", orgId),
      },
      {
        id: "cad",
        label: "Open CAD",
        detail: "Confirm which mechanisms you plan to model after the first brief.",
        href: hubHref("/build", "cad", orgId),
      },
    ].slice(0, 4);
  }

  const actions: SketchToBriefNextAction[] = [];

  if (draftCount > 0 && briefCount === 0) {
    actions.push({
      id: "generate-brief",
      label: "Generate a CAD brief",
      detail: `${draftCount} draft sketch${draftCount === 1 ? "" : "es"} ready — briefs use only logged notes and Kickoff grounding.`,
      href: "#sketch-to-brief-sketches",
      primary: true,
    });
  } else if (ruleFlagCount > 0) {
    actions.push({
      id: "review-flags",
      label: "Review rule-compliance flags",
      detail: `${ruleFlagCount} flag${ruleFlagCount === 1 ? "" : "s"} grounded in Kickoff notes.`,
      href: "#sketch-to-brief-briefs",
      primary: true,
    });
  } else if (briefCount === 0) {
    actions.push({
      id: "generate-brief",
      label: "Generate a CAD brief",
      detail: "Pick a logged sketch and draft a first-pass brief.",
      href: "#sketch-to-brief-sketches",
      primary: true,
    });
  }

  actions.push(
    {
      id: "kickoff",
      label: "Open Kickoff",
      detail: "Keep rule notes and design priorities aligned with brief grounding.",
      href: hubHref("/build", "kickoff", orgId),
      primary: !actions.some((a) => a.primary),
    },
    {
      id: "cad",
      label: "Open CAD",
      detail: "Turn a drafted brief into real mechanism geometry.",
      href: hubHref("/build", "cad", orgId),
    },
    {
      id: "rule-impact",
      label: "Open Rule Impact",
      detail: "When a flag looks blocking, check season rule deltas against prior subsystems.",
      href: hubHref("/build", "rule-impact", orgId),
    },
  );

  return actions.slice(0, 5);
}
