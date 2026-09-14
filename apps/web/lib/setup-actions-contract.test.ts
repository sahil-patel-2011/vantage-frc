/**
 * Every feature lib's guided lists, checked against each other.
 *
 * Two bugs shipped because nothing compared them:
 *
 *  1. 26 features had an `xSetupSteps` and an `xNextActions({ shell: "setup" })`
 *     that returned *the same ids in the same order* with different labels. A
 *     setup screen rendering both showed a student the identical guided list
 *     twice. They derive from the steps now (see `setup-actions.ts`); this test
 *     is what stops a 27th pair from drifting back apart.
 *  2. Media's no-org next actions listed "Open Outreach calendar" twice.
 *
 * The rules below are the general form of both, applied to every module rather
 * than to the ones someone happened to look at.
 */
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { setupActionsFrom } from "./setup-actions";

const LIB = dirname(fileURLToPath(import.meta.url));

type Action = { id: string; label?: string; detail?: string; href?: string; primary?: boolean };

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) walk(path, out);
    else if (/\.ts$/.test(entry.name) && !/\.test\.ts$/.test(entry.name)) out.push(path);
  }
  return out;
}

/** Modules that export a `*NextActions` and, optionally, a paired `*SetupSteps`. */
function discover() {
  const found: Array<{ file: string; setupFns: string[]; nextFns: string[] }> = [];
  for (const file of walk(LIB)) {
    const src = readFileSync(file, "utf8");
    const nextFns = [...src.matchAll(/export function (\w*NextActions)\s*\(/g)].map((m) => m[1]!);
    if (!nextFns.length) continue;
    const setupFns = [...src.matchAll(/export function (\w*[sS]etupSteps)\s*\(/g)].map((m) => m[1]!);
    found.push({ file, setupFns, nextFns });
  }
  return found;
}

const MODULES = discover();

/**
 * Import every feature lib once. Both assertions below need the same ~160
 * modules, and doing it per-test made this file heavy enough to starve
 * neighbouring suites in a full parallel run.
 */
const LOADED = new Map<string, Record<string, unknown>>();
beforeAll(async () => {
  for (const { file } of MODULES) {
    LOADED.set(file, (await import(/* @vite-ignore */ file)) as Record<string, unknown>);
  }
}, 180_000);

/** Every shell kind any feature classifies into. */
const SHELLS = ["loading", "error", "setup", "empty", "ready", "select", "none"] as const;

function callNextActions(fn: unknown, orgId: string | null, shell: string): Action[] | null {
  try {
    // Most take an input object; a couple take (kind, orgId) positionally.
    const asObject = (fn as (i: Record<string, unknown>) => Action[])({ orgId, shell });
    if (Array.isArray(asObject)) return asObject;
  } catch {
    /* try the positional shape below */
  }
  try {
    const asPositional = (fn as (k: string, o?: string | null) => Action[])(shell, orgId);
    if (Array.isArray(asPositional)) return asPositional;
  } catch {
    /* the helper does not accept this shell */
  }
  return null;
}

describe("next-action lists", () => {
  it("finds the feature libs to check", () => {
    expect(MODULES.length).toBeGreaterThan(100);
  });

  it("never repeats an id inside one list", () => {
    const offenders: string[] = [];
    for (const { file, nextFns } of MODULES) {
      const mod = LOADED.get(file)!;
      for (const name of nextFns) {
        for (const orgId of [null, "org-1"]) {
          for (const shell of SHELLS) {
            const actions = callNextActions(mod[name], orgId, shell);
            if (!actions) continue;
            const ids = actions.map((a) => a.id);
            const dupes = ids.filter((id, index) => ids.indexOf(id) !== index);
            if (dupes.length) {
              offenders.push(
                `${relative(LIB, file).replace(/\\/g, "/")} ${name}(orgId=${orgId}, ${shell}) repeats ${[...new Set(dupes)].join(", ")}`,
              );
            }
          }
        }
      }
    }
    expect(offenders).toEqual([]);
  }, 30_000);

  /**
   * The load-bearing one. If a feature's setup-shell actions carry the same ids
   * in the same order as its setup steps, they ARE that list — so they must be
   * the same objects, produced by `setupActionsFrom`. Anything else is a second
   * copy that will drift, and a screen showing both shows it twice.
   */
  it("derives the setup shell from the setup steps rather than restating them", () => {
    const offenders: string[] = [];
    let derived = 0;
    for (const { file, setupFns, nextFns } of MODULES) {
      if (!setupFns.length) continue;
      const mod = LOADED.get(file)!;
      for (const stepName of setupFns) {
        for (const nextName of nextFns) {
          for (const orgId of [null, "org-1"]) {
            let steps: Action[];
            try {
              steps = (mod[stepName] as (o?: string | null) => Action[])(orgId);
            } catch {
              continue;
            }
            const actions = callNextActions(mod[nextName], orgId, "setup");
            if (!actions) continue;
            const sameIds =
              steps.length === actions.length &&
              steps.every((step, index) => step.id === actions[index]!.id);
            if (!sameIds) continue;
            const expected = setupActionsFrom(steps as Array<Required<Pick<Action, "id" | "label" | "detail" | "href">>>);
            if (JSON.stringify(actions) === JSON.stringify(expected)) {
              derived += 1;
              continue;
            }
            offenders.push(
              `${relative(LIB, file).replace(/\\/g, "/")} ${nextName}(setup) restates ${stepName} instead of deriving from it`,
            );
          }
        }
      }
    }
    expect(offenders).toEqual([]);
    // Guards against the discovery regex silently matching nothing.
    expect(derived).toBeGreaterThan(40);
  }, 30_000);
});
