// Kickoff & Game Analysis — framework-free domain logic shared by the API
// route, the client UI, and unit tests. No server or React imports belong here.

export const PHASES = ["auto", "teleop", "endgame"] as const;
export type Phase = (typeof PHASES)[number];

export const PRIORITY_STATUSES = ["proposed", "prototyping", "committed", "cut"] as const;
export type PriorityStatus = (typeof PRIORITY_STATUSES)[number];

export const RULE_STATUSES = ["open", "answered"] as const;
export type RuleStatus = (typeof RULE_STATUSES)[number];

// ---------------------------------------------------------------------------
// Row + view types (camelCase; the API casts numeric columns to JS numbers).
// ---------------------------------------------------------------------------

export type ScoringAction = {
  id: string;
  seasonYear: number;
  label: string;
  phase: Phase;
  points: number;
  estSeconds: number | null;
  notes: string;
  sortOrder: number;
};

export type DesignPriority = {
  id: string;
  seasonYear: number;
  capability: string;
  rationale: string;
  weight: number;
  status: PriorityStatus;
  linkedActionId: string | null;
};

export type RuleNote = {
  id: string;
  seasonYear: number;
  question: string;
  answer: string;
  ruleRef: string;
  status: RuleStatus;
};

export type KickoffContext = {
  orgId: string | null;
  orgName: string | null;
  teamNumber: number | null;
  role: string | null;
  defaultSeasonYear: number;
};

export type KickoffView =
  | {
      status: "ready";
      context: KickoffContext;
      actions: ScoringAction[];
      priorities: DesignPriority[];
      ruleNotes: RuleNote[];
    }
  | { status: "setup_required"; context: KickoffContext; message: string };

// ---------------------------------------------------------------------------
// Derived metrics (pure, unit-tested).
// ---------------------------------------------------------------------------

/** Points per second of estimated cycle time, rounded to 2dp; null without an estimate. */
export function pointsPerSecond(action: Pick<ScoringAction, "points" | "estSeconds">): number | null {
  if (action.estSeconds == null || action.estSeconds <= 0) return null;
  return Math.round((action.points / action.estSeconds) * 100) / 100;
}

/**
 * Kickoff value ranking: actions with a cycle-time estimate first (best pts/sec,
 * ties broken by raw points), then unestimated actions by raw points.
 */
export function rankActions(actions: ScoringAction[]): ScoringAction[] {
  const timed: Array<{ action: ScoringAction; rate: number }> = [];
  const untimed: ScoringAction[] = [];
  for (const action of actions) {
    const rate = pointsPerSecond(action);
    if (rate == null) untimed.push(action);
    else timed.push({ action, rate });
  }
  timed.sort((a, b) => b.rate - a.rate || b.action.points - a.action.points);
  untimed.sort((a, b) => b.points - a.points);
  return [...timed.map((entry) => entry.action), ...untimed];
}

export type KickoffSummary = {
  actions: number;
  bestAction: string | null;
  committed: number;
  openQuestions: number;
};

export function kickoffSummary(actions: ScoringAction[], priorities: DesignPriority[], ruleNotes: RuleNote[]): KickoffSummary {
  const best = rankActions(actions).find((action) => pointsPerSecond(action) != null) ?? null;
  return {
    actions: actions.length,
    bestAction: best ? best.label : null,
    committed: priorities.filter((priority) => priority.status === "committed").length,
    openQuestions: ruleNotes.filter((note) => note.status === "open").length,
  };
}

// ---------------------------------------------------------------------------
// Action validation (mirrors the other module parse patterns).
// ---------------------------------------------------------------------------

function requiredText(value: unknown, label: string, max: number) {
  const text = String(value ?? "").trim();
  if (!text) throw new Error(`${label} is required`);
  if (text.length > max) throw new Error(`${label} must be ${max} characters or fewer`);
  return text;
}

function optionalText(value: unknown, max: number) {
  if (value == null) return null;
  const text = String(value).trim();
  if (!text) return null;
  if (text.length > max) throw new Error(`Value must be ${max} characters or fewer`);
  return text;
}

function uuid(value: unknown, label: string) {
  const text = requiredText(value, label, 64);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(text)) {
    throw new Error(`${label} is invalid`);
  }
  return text;
}

function optionalUuid(value: unknown, label: string) {
  if (value == null || value === "") return null;
  return uuid(value, label);
}

function enumValue<T extends string>(value: unknown, allowed: readonly T[], label: string): T {
  const text = requiredText(value, label, 40);
  if (!allowed.includes(text as T)) throw new Error(`Invalid ${label.toLowerCase()}`);
  return text as T;
}

function yearValue(value: unknown) {
  const year = Number(value);
  if (!Number.isInteger(year) || year < 1992 || year > 2100) {
    throw new Error("Season year must be a whole number between 1992 and 2100");
  }
  return year;
}

function pointsValue(value: unknown) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0 || number > 1000) {
    throw new Error("Points must be between 0 and 1000");
  }
  return Math.round(number * 10) / 10;
}

function secondsValue(value: unknown) {
  if (value == null || value === "") return null;
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0 || number > 600) {
    throw new Error("Estimated seconds must be greater than 0 and at most 600");
  }
  return Math.round(number * 10) / 10;
}

function weightValue(value: unknown) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1 || number > 5) {
    throw new Error("Weight must be a whole number between 1 and 5");
  }
  return number;
}

function sortOrderValue(value: unknown) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 0 || number > 100_000) {
    throw new Error("Sort order must be a whole number between 0 and 100000");
  }
  return number;
}

const has = (body: Record<string, unknown>, key: string) => Object.prototype.hasOwnProperty.call(body, key);

export type ScoringActionPatch = {
  label?: string;
  phase?: Phase;
  points?: number;
  estSeconds?: number | null;
  notes?: string;
  sortOrder?: number;
};

export type DesignPriorityPatch = {
  capability?: string;
  rationale?: string;
  weight?: number;
  status?: PriorityStatus;
  linkedActionId?: string | null;
};

export type RuleNotePatch = {
  question?: string;
  answer?: string;
  ruleRef?: string;
  status?: RuleStatus;
};

export type KickoffAction =
  | {
      action: "add_action";
      orgId: string;
      seasonYear: number;
      label: string;
      phase: Phase;
      points: number;
      estSeconds: number | null;
      notes: string;
    }
  | { action: "update_action"; orgId: string; id: string; patch: ScoringActionPatch }
  | { action: "delete_action"; orgId: string; id: string }
  | {
      action: "add_priority";
      orgId: string;
      seasonYear: number;
      capability: string;
      rationale: string;
      weight: number;
      linkedActionId: string | null;
    }
  | { action: "update_priority"; orgId: string; id: string; patch: DesignPriorityPatch }
  | { action: "delete_priority"; orgId: string; id: string }
  | { action: "add_rule_note"; orgId: string; seasonYear: number; question: string; ruleRef: string }
  | { action: "update_rule_note"; orgId: string; id: string; patch: RuleNotePatch }
  | { action: "delete_rule_note"; orgId: string; id: string };

export function parseKickoffAction(input: unknown): KickoffAction {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Invalid kickoff action");
  const body = input as Record<string, unknown>;
  const action = requiredText(body.action, "Action", 40);
  const orgId = uuid(body.orgId, "Organization");

  switch (action) {
    case "add_action":
      return {
        action,
        orgId,
        seasonYear: yearValue(body.seasonYear),
        label: requiredText(body.label, "Scoring action", 160),
        phase: has(body, "phase") ? enumValue(body.phase, PHASES, "Phase") : "teleop",
        points: pointsValue(body.points),
        estSeconds: secondsValue(body.estSeconds),
        notes: optionalText(body.notes, 2_000) ?? "",
      };

    case "update_action": {
      const patch: ScoringActionPatch = {};
      if (has(body, "label")) patch.label = requiredText(body.label, "Scoring action", 160);
      if (has(body, "phase")) patch.phase = enumValue(body.phase, PHASES, "Phase");
      if (has(body, "points")) patch.points = pointsValue(body.points);
      if (has(body, "estSeconds")) patch.estSeconds = secondsValue(body.estSeconds);
      if (has(body, "notes")) patch.notes = optionalText(body.notes, 2_000) ?? "";
      if (has(body, "sortOrder")) patch.sortOrder = sortOrderValue(body.sortOrder);
      if (Object.keys(patch).length === 0) throw new Error("No changes provided");
      return { action, orgId, id: uuid(body.id, "Scoring action"), patch };
    }

    case "delete_action":
      return { action, orgId, id: uuid(body.id, "Scoring action") };

    case "add_priority":
      return {
        action,
        orgId,
        seasonYear: yearValue(body.seasonYear),
        capability: requiredText(body.capability, "Capability", 160),
        rationale: optionalText(body.rationale, 2_000) ?? "",
        weight: has(body, "weight") ? weightValue(body.weight) : 3,
        linkedActionId: optionalUuid(body.linkedActionId, "Linked action"),
      };

    case "update_priority": {
      const patch: DesignPriorityPatch = {};
      if (has(body, "capability")) patch.capability = requiredText(body.capability, "Capability", 160);
      if (has(body, "rationale")) patch.rationale = optionalText(body.rationale, 2_000) ?? "";
      if (has(body, "weight")) patch.weight = weightValue(body.weight);
      if (has(body, "status")) patch.status = enumValue(body.status, PRIORITY_STATUSES, "Status");
      if (has(body, "linkedActionId")) patch.linkedActionId = optionalUuid(body.linkedActionId, "Linked action");
      if (Object.keys(patch).length === 0) throw new Error("No changes provided");
      return { action, orgId, id: uuid(body.id, "Priority"), patch };
    }

    case "delete_priority":
      return { action, orgId, id: uuid(body.id, "Priority") };

    case "add_rule_note":
      return {
        action,
        orgId,
        seasonYear: yearValue(body.seasonYear),
        question: requiredText(body.question, "Question", 500),
        ruleRef: optionalText(body.ruleRef, 80) ?? "",
      };

    case "update_rule_note": {
      const patch: RuleNotePatch = {};
      if (has(body, "question")) patch.question = requiredText(body.question, "Question", 500);
      if (has(body, "answer")) patch.answer = optionalText(body.answer, 2_000) ?? "";
      if (has(body, "ruleRef")) patch.ruleRef = optionalText(body.ruleRef, 80) ?? "";
      if (has(body, "status")) patch.status = enumValue(body.status, RULE_STATUSES, "Status");
      if (Object.keys(patch).length === 0) throw new Error("No changes provided");
      return { action, orgId, id: uuid(body.id, "Rule note"), patch };
    }

    case "delete_rule_note":
      return { action, orgId, id: uuid(body.id, "Rule note") };

    default:
      throw new Error("Unsupported kickoff action");
  }
}
