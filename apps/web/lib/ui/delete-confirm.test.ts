/**
 * A Delete or Remove button that sends the action on its first tap loses a saved record to a
 * mis-tap on a phone. Each one asks first: askConfirm()/useConfirm() for the app's dialog, or a
 * two-step control. This finds buttons whose click handler posts an action inline with nothing
 * asking. Handlers passed by name (onClick={onDelete}) are not followed; their call sites are.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const WEB = join(__dirname, "..", "..");
const ROOTS = [join(WEB, "app"), join(WEB, "components")];

function collect(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry.startsWith(".") || entry === "node_modules") continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) collect(full, acc);
    else if (entry.endsWith(".tsx") && !entry.includes(".test.")) acc.push(full);
  }
  return acc;
}

const BUTTON = /<(Button|button)\b((?:[^>]|=>)*?)>\s*((?:Delete|Remove)\b[^<{]*)<\/\1>/g;
const SENDS = /\b(post|run|mutate|fetch|act|runVideo|runRescout)\(|action:/;

describe("Delete and Remove buttons ask before sending", () => {
  it("has no one-tap delete of a saved record", () => {
    const problems: string[] = [];
    for (const file of ROOTS.flatMap((root) => collect(root))) {
      const src = readFileSync(file, "utf8");
      for (const match of src.matchAll(BUTTON)) {
        const handler = /onClick=\{([\s\S]*)\}/.exec(match[2] ?? "")?.[1] ?? "";
        if (!SENDS.test(handler) || /confirm/i.test(handler)) continue;
        const line = src.slice(0, match.index).split("\n").length;
        problems.push(`${file.replace(WEB, "")}:${line} "${(match[3] ?? "").trim()}"`);
      }
    }
    expect(problems).toEqual([]);
  });
});
