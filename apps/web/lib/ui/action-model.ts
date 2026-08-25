/**
 * Action hierarchy model — the pure half of `<ActionMenu>`.
 *
 * Enforces R4 from docs/UI_DESIGN_RULES.md ("Exactly one primary (brand-token) button per
 * screen. Zero is allowed. Two is a bug.") plus R18 (a destructive action never sits in the
 * fast path). The audit that started this work counted 1,370 raw `<button>` elements against
 * 46 uses of the shared `<Button>` — a row of six sibling buttons is the shape being replaced.
 *
 * Deliberately dependency-free and DOM-free so it can be unit-tested under node-only vitest.
 */

/** Every action a surface can offer, before the hierarchy rule is applied. */
export type ActionSpec = {
  /** Stable identity — used as the React key and for focus bookkeeping. */
  id: string;
  label: string;
  /** Click handler. Omitted for actions rendered as links via `href`. */
  onClick?: () => void;
  href?: string;
  /**
   * Author's intent. `"primary"` is a request, not a guarantee: at most one wins, and a
   * destructive action never does. Default `"normal"`.
   */
  intent?: "primary" | "normal" | "destructive";
  /** Explicit ordering hint; lower sorts first. Ties fall back to input order (stable). */
  weight?: number;
  disabled?: boolean;
  /** Shown as a hint under/next to the label in the overflow menu. */
  hint?: string;
  /** Renders a keyboard shortcut on the right of the overflow row (the Raycast lesson). */
  shortcut?: string;
  /** Preserved verbatim so existing E2E selectors keep working through the consolidation. */
  testId?: string;
  /** Non-visual grouping label used to draw separators in the overflow menu. */
  group?: string;
};

/** An action plus the placement the model decided for it. */
export type ResolvedAction = ActionSpec & {
  placement: "primary" | "secondary" | "overflow";
  /**
   * True when the action mutates destructively. Always `true` for `intent: "destructive"`.
   * Callers must route these through `useConfirm()` — never fire them straight from a click.
   */
  needsConfirm: boolean;
};

export type ActionModel = {
  /** At most one. `null` on read-only surfaces, or when every action is destructive. */
  primary: ResolvedAction | null;
  /** At most `maxSecondary` (default 2). */
  secondary: ResolvedAction[];
  /** Everything else, in stable order. Destructive actions are always here. */
  overflow: ResolvedAction[];
};

export type BuildActionModelOptions = {
  /**
   * How many neutral buttons may sit beside the primary before the rest fall into overflow.
   * Defaults to 2 (three visible controls total). Clamped to >= 0.
   */
  maxSecondary?: number;
  /**
   * When true, a disabled action can still hold the primary slot (useful when the disable is
   * transient, e.g. "Saving…"). Defaults to true — a disabled primary still teaches what the
   * surface is for. Set false to let a usable action take the slot instead.
   */
  allowDisabledPrimary?: boolean;
};

const DEFAULT_MAX_SECONDARY = 2;

function isDestructive(action: ActionSpec): boolean {
  return action.intent === "destructive";
}

/**
 * Stable sort by `weight` (absent = 0), preserving input order within equal weights.
 * `Array.prototype.sort` is spec-stable in every runtime this ships to, but the index tiebreak
 * is written out so the ordering guarantee is a property of this function, not of the engine.
 */
function stableByWeight(actions: ActionSpec[]): ActionSpec[] {
  return actions
    .map((action, index) => ({ action, index }))
    .sort((a, b) => (a.action.weight ?? 0) - (b.action.weight ?? 0) || a.index - b.index)
    .map((entry) => entry.action);
}

function resolve(action: ActionSpec, placement: ResolvedAction["placement"]): ResolvedAction {
  return { ...action, placement, needsConfirm: isDestructive(action) };
}

/**
 * Collapse a flat action list into one primary, up to two secondary, and an overflow tail.
 *
 * Invariants (all covered by action-model.test.ts):
 *  1. `primary` is never an array and never a destructive action.
 *  2. Every input action appears exactly once across the three buckets — this is a
 *     consolidation, never a removal.
 *  3. Ordering is deterministic: weight ascending, then input order.
 *  4. Duplicate ids collapse to the first occurrence, so a re-render can't double-fire.
 */
export function buildActionModel(
  actions: readonly ActionSpec[],
  options: BuildActionModelOptions = {},
): ActionModel {
  const maxSecondary = Math.max(0, options.maxSecondary ?? DEFAULT_MAX_SECONDARY);
  const allowDisabledPrimary = options.allowDisabledPrimary ?? true;

  const seen = new Set<string>();
  const unique: ActionSpec[] = [];
  for (const action of actions) {
    if (!action || !action.id || seen.has(action.id)) continue;
    seen.add(action.id);
    unique.push(action);
  }

  const ordered = stableByWeight(unique);
  const destructive = ordered.filter(isDestructive);
  const safe = ordered.filter((action) => !isDestructive(action));

  // Exactly one primary: the first action that *asked* to be primary, else the first safe
  // action. Destructive candidates are never considered.
  const candidates = allowDisabledPrimary ? safe : safe.filter((action) => !action.disabled);
  const primarySpec = candidates.find((action) => action.intent === "primary") ?? candidates[0] ?? null;

  const rest = safe.filter((action) => action !== primarySpec);
  const secondarySpecs = rest.slice(0, maxSecondary);
  const overflowSpecs = rest.slice(maxSecondary);

  return {
    primary: primarySpec ? resolve(primarySpec, "primary") : null,
    secondary: secondarySpecs.map((action) => resolve(action, "secondary")),
    // Destructive actions always land in overflow, after the demoted safe actions.
    overflow: [
      ...overflowSpecs.map((action) => resolve(action, "overflow")),
      ...destructive.map((action) => resolve(action, "overflow")),
    ],
  };
}

/** Flatten a model back to a list — used by tests and by keyboard roving order. */
export function flattenActionModel(model: ActionModel): ResolvedAction[] {
  return [...(model.primary ? [model.primary] : []), ...model.secondary, ...model.overflow];
}

/** Count of actions that are one tap away (primary + secondary). Used by layout heuristics. */
export function visibleActionCount(model: ActionModel): number {
  return (model.primary ? 1 : 0) + model.secondary.length;
}
