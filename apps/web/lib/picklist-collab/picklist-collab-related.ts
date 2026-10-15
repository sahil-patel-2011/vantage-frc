import { hubHref } from "../nav/hubs";

export type PicklistCollabShellKind = "loading" | "error" | "setup" | "empty" | "ready";

export type PicklistCollabEmptyCopy = {
  kind: PicklistCollabShellKind;
  badge?: string;
  title: string;
  description: string;
};

export type PicklistCollabSetupStepLink = {
  id: string;
  label: string;
  detail: string;
  href: string;
};

export function picklistCollabSetupSteps(orgId?: string | null): PicklistCollabSetupStepLink[] {
  if (!orgId) {
    return [
      {
        id: "workspace",
        label: "Choose your team",
        detail: "Choose your team to open pick lists.",
        href: "/workspace",
      },
    ];
  }
  return [
    {
      id: "command",
      label: "Set active event",
      detail: "Pick the event this alliance is at — ranks stay empty until it is set.",
      href: hubHref("/competition", "command", orgId),
    },
  ];
}

/** Classify Collaborative Pick List Soft-UI shell — never invents DEMO ranks. */
export function classifyPicklistCollabShell(input: {
  loading?: boolean;
  fetchFailed?: boolean;
  status?: "setup_required" | "live" | null;
  orgId?: string | null;
  listCount?: number;
  /** Ids of the setup steps the server sent with a setup_required view. */
  setupStepIds?: string[];
}): PicklistCollabShellKind {
  if (input.loading) return "loading";
  if (input.fetchFailed) return "error";
  if (!input.orgId) return "setup";
  // The server says "setup_required" for two different things: no team yet,
  // and a team with no pick lists yet. The second is the empty state with the
  // create form — sending it to "Choose your team" left every new team with no
  // way to make their first list.
  if (input.status === "setup_required") {
    return input.setupStepIds?.includes("create-list") ? "empty" : "setup";
  }
  if ((input.listCount ?? 0) === 0) return "empty";
  return "ready";
}

/** Soft-UI empty / setup / error copy — never DEMO ranks. */
export function picklistCollabShellCopy(kind: PicklistCollabShellKind): PicklistCollabEmptyCopy {
  switch (kind) {
    case "loading":
      return {
        kind,
        title: "Loading Collaborative Pick List…",
        description: "Checking which team you are on and pick lists.",
      };
    case "error":
      return {
        kind,
        badge: "Unavailable",
        title: "Could not load Collaborative Pick List",
        description:
          "A network or server issue blocked the list. Retry, or open Strategy / Scouting while it reloads.",
      };
    case "setup":
      return {
        kind,
        badge: "Needs setup",
        title: "Choose your team",
        description:
          "Choose your team before ranking teams.",
      };
    case "empty":
      return {
        kind,
        badge: "No lists yet",
        title: "Create your first pick list",
        description:
          "Name a list for your event key, then add teams and cast weighted votes. Consensus stays blank until real votes exist.",
      };
    default:
      return {
        kind: "ready",
        title: "Collaborative pick consensus",
        description:
          "Tiers and weighted votes from your team only.",
      };
  }
}

