/**
 * Page toolbar hierarchy — the pure half of `<PageToolbar>`.
 *
 * One filled primary. At most three quiet secondary actions. Everything else,
 * and every destructive action, goes under a single More menu. A destructive
 * action never sits beside the primary. Nothing is dropped: every input appears
 * once.
 *
 * DOM-free so node-only vitest can lock the rule.
 */

export const PAGE_TOOLBAR_MAX_SECONDARY = 3;

/**
 * Stable marker for a custom toolbar control. Function `.name` is rewritten
 * in a production build, so the toolbar must not recognize actions by name.
 */
export const TOOLBAR_ACTION_KEY = "vantage-toolbar-action";

export function markToolbarAction<T extends object>(component: T): T {
  (component as unknown as Record<string, unknown>)[TOOLBAR_ACTION_KEY] = "action";
  return component;
}

export function isMarkedToolbarAction(type: unknown): boolean {
  return typeof type === "function" && (type as unknown as Record<string, unknown>)[TOOLBAR_ACTION_KEY] === "action";
}

export type PageActionIntent = "primary" | "secondary" | "destructive" | "chrome";

export type PageActionInput = {
  id: string;
  intent: PageActionIntent;
};

export type PageToolbarLayout = {
  /** Not actions: related links, badges, layout switches. Kept in place. */
  chrome: string[];
  /** Quiet actions, capped. */
  secondary: string[];
  /** The one filled action, or null when the surface did not ask for one. */
  primary: string | null;
  /** Demoted actions and every destructive action. */
  overflow: string[];
};

/**
 * Collapse a header or card toolbar.
 *
 * A primary is only the first action that asked to be primary. Extra primaries
 * become quiet actions (then overflow past the cap). The first quiet action is
 * not promoted: a page with no filled button stays that way.
 */
export function layoutPageToolbar(
  actions: readonly PageActionInput[],
  maxSecondary: number = PAGE_TOOLBAR_MAX_SECONDARY,
): PageToolbarLayout {
  const cap = Math.max(0, maxSecondary);
  const chrome: string[] = [];
  const primaries: string[] = [];
  const secondaries: string[] = [];
  const destructive: string[] = [];
  const seen = new Set<string>();

  for (const action of actions) {
    if (!action?.id || seen.has(action.id)) continue;
    seen.add(action.id);
    switch (action.intent) {
      case "chrome":
        chrome.push(action.id);
        break;
      case "primary":
        primaries.push(action.id);
        break;
      case "secondary":
        secondaries.push(action.id);
        break;
      case "destructive":
        destructive.push(action.id);
        break;
      default: {
        const never: never = action.intent;
        throw new Error(`Unknown toolbar intent: ${String(never)}`);
      }
    }
  }

  const primary = primaries[0] ?? null;
  const quiet = [...secondaries, ...primaries.slice(1)];
  return {
    chrome,
    secondary: quiet.slice(0, cap),
    primary,
    overflow: [...quiet.slice(cap), ...destructive],
  };
}

/** Controls a person sees before opening More: quiet actions, the primary, and More itself. */
export function visibleToolbarControls(layout: PageToolbarLayout): number {
  return layout.secondary.length + (layout.primary ? 1 : 0) + (layout.overflow.length > 0 ? 1 : 0);
}
