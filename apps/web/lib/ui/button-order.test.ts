/**
 * Button order for "are you sure?" steps and step-by-step setup, the way Apple and Google
 * both lay them out and the way the shared ConfirmDialog already does:
 *
 *   [Cancel] [Yes, record it]        dismissive on the left, the confirming action on the right
 *   [Back]   [Continue]              back on the left, forward on the right
 *
 * Ordinary inline forms ("Save changes", "Add contact" then Cancel) keep the primary first and
 * are not checked here: a left-aligned form reads its main action first.
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

const ELEMENT = String.raw`(?:<Button\b[^>]*>(?:(?!</?Button\b)[\s\S])*?</Button>|<button\b[^>]*>(?:(?!</?button\b)[\s\S])*?</button>)`;
const PAIR = new RegExp(`(${ELEMENT})\\s*(?:\\{" "\\})?\\s*(${ELEMENT})`, "g");
const CONFIRMING = /^(Yes,|Confirm\b|Accept\b|Dismiss this\b)/;
const FORWARD = /^(Continue|Next)$/;

function label(element: string): string {
  return element.replace(/<[^>]*>/g, " ").replace(/\{[^}]*\}/g, " ").replace(/\s+/g, " ").trim();
}

describe("button order (Apple / Google)", () => {
  const files = ROOTS.flatMap((root) => collect(root));

  it("puts Cancel before the confirming action, and Back before Continue", () => {
    const problems: string[] = [];
    for (const file of files) {
      const src = readFileSync(file, "utf8");
      for (const match of src.matchAll(PAIR)) {
        const first = label(match[1] ?? "");
        const second = label(match[2] ?? "");
        const line = src.slice(0, match.index).split("\n").length;
        if (CONFIRMING.test(first) && /^(Cancel|Back|Not now)$/.test(second)) {
          problems.push(`${file.replace(WEB, "")}:${line} "${first}" comes before "${second}"`);
        }
        if (FORWARD.test(first) && second === "Back") {
          problems.push(`${file.replace(WEB, "")}:${line} "${first}" comes before "Back"`);
        }
      }
    }
    expect(problems).toEqual([]);
  });

  it("finds the components it checks", () => {
    expect(files.length).toBeGreaterThan(300);
  });
});
