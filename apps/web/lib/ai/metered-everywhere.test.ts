/**
 * Every model call goes through the meter.
 *
 * Spend limits in Vantage are enforced in one place: `meteredAI` locks
 * `org_billing`, sums the usage ledger, refuses the call when the team is over
 * its cap, and appends the usage afterwards. There is no denormalised credit
 * counter to check instead, which is deliberate — a counter can drift, a sum
 * cannot.
 *
 * That design has exactly one way to defeat it, and it is not a clever one:
 * call the provider adapter directly. A route that does `adapter.complete(...)`
 * outside the meter spends a team's money, or their own API key's quota,
 * without any limit applying and without leaving a row behind. Nothing about
 * such a route looks wrong in review — it looks like every other route, minus
 * one wrapper.
 *
 * So the rule is checked rather than remembered. Source is read here rather
 * than behaviour, because the point is to catch the call that is never
 * exercised in a test — the new feature, on the branch, that nobody thought to
 * meter.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "..", "..");
const SCAN = ["app", "lib"].map((dir) => join(ROOT, dir));

/**
 * Files that hand a closure to the meter instead of calling it themselves.
 *
 * `MeteredInvoke` is the assembly-manual writer's contract: the runner builds
 * the closure and the caller wraps it in `meteredAI`. The call is metered, one
 * function further out than this check can see, so the exception is named
 * here with the type that makes it true rather than left to a comment.
 */
const HANDS_OFF_TO_METER = new Map<string, string>([
  ["lib/assembly-manual/worker.ts", "returns a MeteredInvoke; run.ts wraps it in meteredAI"],
]);

/**
 * The file with its comments blanked out, offsets preserved.
 *
 * The first version of this check reported `lib/chat/history-context.ts` for a
 * doc comment that says "Prior turns for `adapter.complete({ history })`" —
 * a sentence about the call, not the call. Blanking rather than deleting keeps
 * every offset where it was, so the line numbers in a failure still point at
 * the real line.
 *
 * Walks the text tracking strings and templates too, so a `//` inside a URL
 * is not mistaken for the start of a comment.
 */
function codeOnly(text: string): string {
  const out = text.split("");
  let index = 0;
  while (index < text.length) {
    const char = text[index];
    const next = text[index + 1];
    if (char === "/" && next === "/") {
      while (index < text.length && text[index] !== "\n") out[index++] = " ";
      continue;
    }
    if (char === "/" && next === "*") {
      const end = text.indexOf("*/", index + 2);
      const stop = end === -1 ? text.length : end + 2;
      for (; index < stop; index += 1) if (text[index] !== "\n") out[index] = " ";
      continue;
    }
    if (char === '"' || char === "'" || char === "`") {
      const quote = char;
      index += 1;
      while (index < text.length) {
        if (text[index] === "\\") {
          index += 2;
          continue;
        }
        if (text[index] === quote) {
          index += 1;
          break;
        }
        index += 1;
      }
      continue;
    }
    index += 1;
  }
  return out.join("");
}

function sourceFiles(dir: string, acc: string[] = []): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return acc;
  }
  for (const entry of entries) {
    if (entry === "node_modules" || entry.startsWith(".")) continue;
    const full = join(dir, entry);
    let stats;
    try {
      stats = statSync(full);
    } catch {
      continue;
    }
    if (stats.isDirectory()) sourceFiles(full, acc);
    else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) acc.push(full);
  }
  return acc;
}

/**
 * The character ranges covered by every `meteredAI(` call in `text`.
 *
 * Brace-matched from the opening parenthesis, so a `complete()` nested three
 * callbacks deep inside the `invoke` option still counts as inside — which it
 * is, and which a line-distance heuristic would get wrong for exactly the long
 * handlers where it matters.
 */
function meteredRanges(text: string): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  const marker = /\bmeteredAI\s*(?:<[^>]*>\s*)?\(/g;
  let match: RegExpExecArray | null;
  while ((match = marker.exec(text))) {
    let depth = 0;
    let index = match.index + match[0].length - 1;
    for (; index < text.length; index += 1) {
      const char = text[index];
      if (char === "(") depth += 1;
      else if (char === ")") {
        depth -= 1;
        if (depth === 0) break;
      }
    }
    ranges.push([match.index, index]);
  }
  return ranges;
}

const files = SCAN.flatMap((dir) => sourceFiles(dir));

describe("AI spend cannot be made outside the meter", () => {
  it("finds the source tree it is supposed to be checking", () => {
    // A path change that quietly emptied this list would turn the whole file
    // into a test that passes by looking at nothing.
    expect(files.length).toBeGreaterThan(500);
    expect(files.some((file) => file.replace(/\\/g, "/").endsWith("app/api/calendar/route.ts"))).toBe(
      true,
    );
  });

  it("has no adapter call outside a meteredAI block", () => {
    const offenders: string[] = [];
    for (const file of files) {
      const relative = file.replace(/\\/g, "/").slice(ROOT.replace(/\\/g, "/").length + 1);
      if (HANDS_OFF_TO_METER.has(relative)) continue;

      let text: string;
      try {
        text = readFileSync(file, "utf8");
      } catch {
        continue;
      }
      // `.complete({` is the provider call. Narrow on purpose: this is about
      // chat adapters, not every method in the app named complete.
      const code = codeOnly(text);
      const calls = [...code.matchAll(/\badapter\s*\.\s*complete\s*\(/g)];
      if (!calls.length) continue;

      const ranges = meteredRanges(code);
      for (const call of calls) {
        const inside = ranges.some(([from, to]) => call.index! > from && call.index! < to);
        if (inside) continue;
        const line = text.slice(0, call.index).split("\n").length;
        offenders.push(`${relative}:${line}`);
      }
    }

    expect(
      offenders,
      `adapter.complete() outside meteredAI — these spend without a limit applying:\n  ${offenders.join("\n  ")}`,
    ).toEqual([]);
  });

  it("keeps the hand-off list honest", () => {
    // An exception that no longer exists is an exception somebody can reuse
    // without noticing it stopped being true.
    for (const [relative, reason] of HANDS_OFF_TO_METER) {
      const full = join(ROOT, relative);
      const text = readFileSync(full, "utf8");
      expect(reason.length, `${relative} needs a reason`).toBeGreaterThan(20);
      expect(text, `${relative} no longer produces a MeteredInvoke`).toContain("MeteredInvoke");
    }
  });
});
