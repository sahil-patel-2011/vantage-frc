/**
 * Destructive actions and disabled buttons, the Apple / Google / Microsoft way:
 *
 *  - A delete never comes straight before the way in (Edit, Open, Switch…) in the same row.
 *    It goes last, apart, or behind a "More" menu.
 *  - Where a screen has been brought onto the button system, every Delete / Remove / Discard /
 *    Revoke / Disconnect / Clear button is red (tone="danger", or variant="danger" for a confirm
 *    step), never the accent or a neutral grey.
 *  - A button's label is the action. "Pick a robot above to save" on a greyed-out Save, or a
 *    label that changes to "Tap again to save", hides the instruction inside the control.
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

// An opening tag may hold arrow functions (`onClick={() => …}`), so `=>` does not end it.
const OPEN = (tag: string) => String.raw`<${tag}\b(?:=>|[^>])*>`;
const ELEMENT = String.raw`(?:${OPEN("Button")}(?:(?!</?Button\b)[\s\S])*?</Button>|${OPEN("button")}(?:(?!</?button\b)[\s\S])*?</button>)`;
// Two controls side by side, also when each is wrapped in its own `{cond ? ( … ) : null}`.
const PAIR = new RegExp(`(${ELEMENT})\\s*(?:\\{" "\\})?\\s*(?:\\)\\s*:\\s*null\\}\\s*\\{[^<]*\\(\\s*)?(${ELEMENT})`, "g");
const BUTTON = new RegExp(String.raw`<Button\b((?:=>|[^>])*)>((?:(?!</?Button\b)[\s\S])*?)</Button>`, "g");
const DESTRUCTIVE = /^(Delete|Remove|Discard|Revoke|Disconnect|Clear)\b/;
const WAY_IN = /^(Edit|Open|Switch|Rename|Share)\b/;

/** Every wording a control can show: its plain text, and each string in a `{busy ? "…" : "…"}`. */
function labels(element: string): string[] {
  const inner = element.replace(/^<(?:Button|button)\b(?:=>|[^>])*>/, "").replace(/<\/(?:Button|button)>$/, "");
  const quoted = [...inner.matchAll(/"([^"\n]+)"/g)].map((m) => m[1]!.trim());
  const plain = inner.replace(/<[^>]*>/g, " ").replace(/\{[^}]*\}/g, " ").replace(/\s+/g, " ").trim();
  return [plain, ...quoted].filter(Boolean);
}
const isA = (pattern: RegExp, element: string) => labels(element).some((text) => pattern.test(text));

/** Screens brought onto the button system in batch 1; the list grows as screens are reworked. */
const ON_SYSTEM = [
  "app/account/teams/teams-client.tsx",
  "app/learn/team/team-lessons-client.tsx",
  "app/attendance/attendance-client.tsx",
  "app/scouting/scouting-ready-view.tsx",
  "app/scouting/free-scout-view.tsx",
  "app/scouting/scouting-quarantine.tsx",
  "app/scouting/forms/scoring-formulas.tsx",
  "app/connectors/connectors-client.tsx",
  "app/team/discord/discord-client.tsx",
];

describe("destructive placement", () => {
  const files = ROOTS.flatMap((root) => collect(root));

  it("never puts a delete straight before the way in", () => {
    const problems: string[] = [];
    for (const file of files) {
      const src = readFileSync(file, "utf8");
      for (const match of src.matchAll(PAIR)) {
        const first = match[1] ?? "";
        const second = match[2] ?? "";
        if (isA(DESTRUCTIVE, first) && isA(WAY_IN, second)) {
          const line = src.slice(0, match.index).split("\n").length;
          problems.push(`${file.replace(WEB, "")}:${line} "${labels(first)[0]}" comes before "${labels(second)[0]}"`);
        }
      }
    }
    expect(problems).toEqual([]);
  });

  it("colours every destructive button red on screens that are on the system", () => {
    const problems: string[] = [];
    for (const rel of ON_SYSTEM) {
      const src = readFileSync(join(WEB, rel), "utf8");
      for (const match of src.matchAll(BUTTON)) {
        const attrs = match[1] ?? "";
        if (!isA(DESTRUCTIVE, match[0])) continue;
        if (/tone="danger"|variant="danger"/.test(attrs)) continue;
        const line = src.slice(0, match.index).split("\n").length;
        problems.push(`${rel}:${line} "${labels(match[0])[0]}" is not red`);
      }
    }
    expect(problems).toEqual([]);
  });

  it("never writes the instruction into a disabled button's label", () => {
    const problems: string[] = [];
    for (const file of files) {
      const src = readFileSync(file, "utf8");
      for (const match of src.matchAll(/"([^"\n]*\b(?:above to save|Tap again to save)\b[^"\n]*)"/g)) {
        const line = src.slice(0, match.index).split("\n").length;
        problems.push(`${file.replace(WEB, "")}:${line} "${match[1]}"`);
      }
    }
    expect(problems).toEqual([]);
  });

  it("would have caught the old lessons row (Discard draft before Edit)", () => {
    const old = `<Button variant="ghost" size="sm" onClick={() => onDiscard(lesson)}>
            {discarding ? "Discarding…" : "Discard draft"}
          </Button>
        ) : null}
        {lesson.canEdit ? (
          <Button as="a" variant="ghost" size="sm" href={href}>
            Edit
          </Button>`;
    const match = [...old.matchAll(PAIR)][0];
    expect(match).toBeTruthy();
    expect(isA(DESTRUCTIVE, match![1]!) && isA(WAY_IN, match![2]!)).toBe(true);
  });

  it("checks the screens it lists", () => {
    expect(files.length).toBeGreaterThan(300);
    for (const rel of ON_SYSTEM) expect(readFileSync(join(WEB, rel), "utf8").length).toBeGreaterThan(0);
  });
});
