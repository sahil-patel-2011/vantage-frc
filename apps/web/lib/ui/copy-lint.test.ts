/**
 * Copy lint: internal engineering vocabulary must never reach a student or mentor.
 *
 * The product is read by high-school students in a pit. Words like "DEMO",
 * "org-scoped", "RLS" or "setup_required" describe how the code is built, not
 * what the reader should do next. Empty states say what is missing and what to
 * do — never why the engineering is honest ("… never DEMO scoring tables").
 *
 * This scans user-visible text in every .tsx under app/, components/, and
 * lib/, plus related-copy modules (`*-related.ts`), the in-app manual, and
 * a few copy-producing helpers. Code comments and identifiers are
 * deliberately out of scope — `type X = "setup_required"` is a state value,
 * `new URLSearchParams()` is an API, and neither is copy.
 *
 * Nothing is whitelisted. If a phrase below is genuinely needed in copy, the
 * copy is wrong.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";

const WEB_ROOT = join(__dirname, "..", "..");
const ROOTS = [join(WEB_ROOT, "app"), join(WEB_ROOT, "components"), join(WEB_ROOT, "lib")];

type Rule = { readonly label: string; readonly pattern: RegExp; readonly why: string };

/**
 * Each pattern is matched against extracted copy only. Patterns are written to
 * hit prose and to miss identifiers (see `looksLikeCode`).
 */
const RULES: readonly Rule[] = [
  {
    label: "DEMO",
    pattern: /\bDEMO\b/,
    why: 'say what the number is, not what it is not — "Last stored row", not "never a DEMO %"',
  },
  {
    label: "never invent",
    pattern: /\bnever\s+invent(s|ed|ing)?\b/i,
    why: "the reader assumes the numbers are real; promising honesty implies the opposite",
  },
  {
    label: "Soft-UI",
    pattern: /\bsoft[-\s]?ui\b/i,
    why: "internal design-system codename; name the product or nothing",
  },
  {
    label: "org-scoped",
    pattern: /\b(?:org|event)[-\s]scoped\b/i,
    why: 'tenancy jargon — say "your team\'s"',
  },
  {
    label: "MODEL",
    pattern: /\bMODEL\b/,
    why: 'internal routing vocabulary — say "advice" or name the source',
  },
  {
    label: "fixture",
    pattern: /\bfixtures?\b/i,
    why: "test vocabulary",
  },
  {
    label: "hard usage cutoff",
    pattern: /\bhard\s+usage\s+cut[-\s]?offs?\b/i,
    why: 'billing internals — say what happens when credits run out',
  },
  {
    label: "RLS",
    pattern: /\bRLS\b/,
    why: "database vocabulary; the reader has no row-level security model",
  },
  {
    label: "setup_required",
    pattern: /\bsetup_required\b/,
    why: 'API state name leaking into copy — say what to configure',
  },
  {
    label: "BYOK",
    pattern: /\bBYOK\b/,
    why: 'billing jargon — say "your own keys"',
  },
  {
    label: "BYO key",
    pattern: /\bBYO\s+keys?\b/i,
    why: 'billing jargon — say "your own keys" or "the team\'s keys"',
  },
  {
    label: "row-level security",
    pattern: /\brow[-\s]level\s+security\b/i,
    why: "database vocabulary",
  },
  {
    label: "will not invent",
    pattern: /\bwill\s+not\s+invent\b/i,
    why: "honesty disclaimer — say what is missing and what to do",
  },
  {
    label: "PAYG",
    pattern: /\bPAYG\b/,
    why: 'billing jargon — say "pay-as-you-go"',
  },
  {
    label: "workspace (as a team picker)",
    pattern:
      /\bopen your workspace\b|\bmore than one workspace\b|\bworkspace membership\b|\bteam workspaces\b|\bworkspace inventory\b|\b(connect|set|finish)\s+workspace\b|\bjoin workspace\b|\bopen workspace\b|\bin workspace\b|\bfrom workspace\b|\bcheck workspace\b|\bcross-check workspace\b|\bworkspace created\b|\bworkspace picks\b|\bworkspace slug\b|\bworkspace\s*→|\bworkspace remembered\b|\bpick an org\b/i,
    why: 'say "team" — students pick 6925, not a workspace',
  },
  {
    label: "allowlist",
    pattern: /\ballowlist(?:s|ed)?\b/i,
    why: 'say what is allowed — "only these tools", not "allowlist"',
  },
  {
    label: "placeholder/demo data disclaimer",
    pattern: /\b(no|never|zero|without)\s+(any\s+)?(placeholder|demo|fake|synthetic|mock|dummy|sample|invented|fabricated)\s+(data|numbers?|metrics?|rows?|values?|names?|stats?|figures?|copy|content)\b/i,
    why: "a disclaimer that the data is real tells the reader nothing to do",
  },
  {
    label: "Select a team",
    pattern: /\bSelect a team\b/,
    why: 'say "Choose your team" — titles and buttons must match',
  },
  {
    label: "Select an active event",
    pattern: /\bSelect an active event\b/i,
    why: 'say "Set active event" as the title/button, or "Set your active event" in a sentence',
  },
  {
    label: "Select event",
    pattern: /\bSelect event\b/i,
    why: 'say "Set active event" — two-word leftover of the old picker label',
  },
  {
    label: "Select an event",
    pattern: /\bSelect an event\b/i,
    why: 'say "Set your active event" in a sentence, or "Set active event" as the title/button',
  },
  {
    label: "Select active event",
    pattern: /\bSelect active event\b/i,
    why: 'say "Set active event" — the Event Day picker heading',
  },
  {
    label: "Select one and come back",
    pattern: /\bSelect one and come back\b/i,
    why: 'say "Choose your team"',
  },
  {
    label: "Select the team",
    pattern: /\bSelect the team\b/i,
    why: 'say "Choose your team"',
  },
  {
    label: "Select a page",
    pattern: /\bSelect a page\b/,
    why: 'say "Choose a page"',
  },
  {
    label: "Select a run",
    pattern: /\bSelect a run\b/,
    why: 'say "Choose a run"',
  },
  {
    label: "Select a repository",
    pattern: /\bSelect a repository\b/,
    why: 'say "Choose a repository"',
  },
  {
    label: "Select a grant",
    pattern: /\bSelect a grant\b/,
    why: 'say "Choose a grant"',
  },
  {
    label: "Select an expense",
    pattern: /\bSelect an expense\b/,
    why: 'say "Choose an expense"',
  },
  {
    label: "pick your organization",
    pattern: /\bpick your organization\b/i,
    why: 'say "choose your team"',
  },
  {
    label: "your organization team number",
    pattern: /\byour organization(?:'s)? team number\b/i,
    why: 'say "your team\'s number"',
  },
  {
    // "Set the real build-season window — no sample timelines." The em-dash
    // clause is the tell: everything before it is the instruction, everything
    // after it is the product promising it did not make the data up. Lower-case
    // "demo" is a real FRC word (a demo event), so only this shape is banned.
    label: "trailing 'and this is not fake' clause",
    pattern: /[—–-]\s*(?:and\s+)?(?:never|no|not|nothing|none|zero)\b[^.]{0,70}?\b(?:demo|samples?|placeholder|fake|mock|dummy|synthetic|invented|fabricated|pre-seeded)\b/i,
    why: "say what the reader should do; the clause after the dash says only that the data is real",
  },
] as const;

function isCopyFile(entry: string): boolean {
  if (entry.endsWith(".test.ts") || entry.endsWith(".test.tsx")) return false;
  if (entry.endsWith(".tsx")) return true;
  // Related-copy modules and the in-app manual are what empty states actually print.
  if (entry.endsWith("-related.ts")) return true;
  if (entry === "articles.ts") return true;
  if (entry === "metered-ai-fail.ts") return true;
  if (entry === "usage-cutoff.ts") return true;
  if (entry === "workspace-join.ts") return true;
  if (entry === "invite-flow.ts") return true;
  if (entry === "catalog.ts") return true;
  // Inspection form labels/hints live in the catalog so the 1k split does not
  // hide student copy from this scan.
  if (entry === "inspection-new-check-model.ts") return true;
  if (entry === "app-shell-model.ts") return true;
  if (entry === "next-match-copy.ts") return true;
  if (entry === "dashboard-home-model.ts") return true;
  if (entry === "snapshot.ts") return true;
  return false;
}

function collectCopy(dir: string, acc: string[] = []): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return acc;
  }
  for (const entry of entries) {
    if (entry.startsWith(".") || entry === "node_modules") continue;
    const full = join(dir, entry);
    let stats;
    try {
      stats = statSync(full);
    } catch {
      continue;
    }
    if (stats.isDirectory()) collectCopy(full, acc);
    else if (isCopyFile(entry)) acc.push(full);
  }
  return acc;
}

const files = ROOTS.flatMap((root) => collectCopy(root));

function isAnySource(entry: string): boolean {
  if (entry.endsWith(".test.ts") || entry.endsWith(".test.tsx") || entry.endsWith(".d.ts")) {
    return false;
  }
  // This file and copy-assertions name the banned phrases on purpose.
  if (entry === "copy-assertions.ts") return false;
  return entry.endsWith(".ts") || entry.endsWith(".tsx");
}

function collectSource(dir: string, acc: string[] = []): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return acc;
  }
  for (const entry of entries) {
    if (entry.startsWith(".") || entry === "node_modules") continue;
    const full = join(dir, entry);
    let stats;
    try {
      stats = statSync(full);
    } catch {
      continue;
    }
    if (stats.isDirectory()) collectSource(full, acc);
    else if (isAnySource(entry)) acc.push(full);
  }
  return acc;
}

const SELECT_RULES = RULES.filter((rule) =>
  [
    "Select a team",
    "Select an active event",
    "Select event",
    "Select an event",
    "Select active event",
    "Select one and come back",
    "Select the team",
    "Select a page",
    "Select a run",
    "Select a preset",
    "Select a repository",
    "Select a grant",
    "Select an expense",
  ].includes(
    rule.label,
  ),
);

/** Replace a span with same-length blanks so byte offsets stay line-accurate. */
function blank(source: string, start: number, end: number, out: string[]): void {
  for (let i = start; i < end; i += 1) {
    out[i] = source[i] === "\n" ? "\n" : " ";
  }
}

/**
 * Remove `//` and block comments without disturbing offsets, so a reported
 * line number still points at the real line in the file.
 */
function stripComments(source: string): string {
  const out = source.split("");
  let i = 0;
  while (i < source.length) {
    const ch = source[i];
    const next = source[i + 1];
    if (ch === "/" && next === "/") {
      let end = source.indexOf("\n", i);
      if (end === -1) end = source.length;
      blank(source, i, end, out);
      i = end;
      continue;
    }
    if (ch === "/" && next === "*") {
      let end = source.indexOf("*/", i + 2);
      end = end === -1 ? source.length : end + 2;
      blank(source, i, end, out);
      i = end;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      // Skip the string body so a `//` inside a URL is not read as a comment.
      // Quote and apostrophe strings cannot contain a raw newline in JS, so a
      // newline means this was JSX prose ("don't"), not a string — bail out
      // rather than swallowing the rest of the file.
      const start = i;
      i += 1;
      let closed = false;
      while (i < source.length) {
        if (source[i] === "\\") {
          i += 2;
          continue;
        }
        if (source[i] === "\n" && ch !== "`") break;
        if (source[i] === ch) {
          closed = true;
          break;
        }
        i += 1;
      }
      i = closed ? i + 1 : start + 1;
      continue;
    }
    i += 1;
  }
  return out.join("");
}

/**
 * A match is code, not copy, when it sits inside an identifier, an import
 * path, a className, or a machine string (snake_case / SCREAMING_CASE with no
 * spaces around it).
 */
function looksLikeCode(line: string, match: string, index: number): boolean {
  const before = line.slice(Math.max(0, index - 40), index);
  const after = line.slice(index + match.length, index + match.length + 40);

  // Part of a longer identifier: URLSearchParams, demoFixtures, useDemoState.
  if (/[A-Za-z0-9_$]$/.test(before) || /^[A-Za-z0-9_$]/.test(after)) return true;
  // An HTML/DOM attribute name, not its value: data-soft-ui="…", aria-…
  if (/(?:^|[\s{(])(?:data|aria)-[A-Za-z-]*$/.test(before)) return true;
  // A machine value rather than a display word: the whole quoted token is
  // snake_case, SCREAMING_CASE or path-like ("setup_required", "demo/x").
  const opened = /(["'])([^"']*)$/.exec(before);
  if (opened) {
    const closeAt = after.indexOf(opened[1]);
    const whole = `${opened[2]}${match}${closeAt === -1 ? "" : after.slice(0, closeAt)}`;
    if (/^[A-Za-z0-9_./:-]+$/.test(whole) && /[_/]/.test(whole)) return true;
    // Quoted identifier with no spaces — a union/enum member ("allowlist"), not a sentence.
    if (/^[A-Za-z][A-Za-z0-9_-]*$/.test(whole)) return true;
  }
  // Property access: foo.fixture
  if (/\.\s*$/.test(before)) return true;
  // An unquoted object key or type member: `setup_required: "Email not set"`.
  if (/^\s*[:?]/.test(after) && /(^|[{,;([]|=>)\s*$/.test(before)) return true;
  // Import specifier / module path.
  if (/from\s+["'][^"']*$/.test(before) || /import\b/.test(before)) return true;
  if (/["'][^"']*$/.test(before) && /^[^"']*["']\s*[,)\]]/.test(after) && /\/|\.\./.test(before.slice(-20))) return true;
  // className / CSS token.
  if (/class(Name)?\s*=?\s*[{"'`][^"'`]*$/.test(before)) return true;
  // A discriminant union member or comparison against a machine value.
  if (/(===|!==|==|!=)\s*["'`]$/.test(before)) return true;
  if (/\|\s*$/.test(before) || /^\s*\|/.test(after)) return true;
  return false;
}

type Finding = { file: string; line: number; label: string; why: string; text: string };

function scan(file: string, rules: readonly Rule[] = RULES): Finding[] {
  const source = readFileSync(file, "utf8");
  const stripped = stripComments(source);
  const lines = stripped.split(/\r?\n/);
  const rel = relative(WEB_ROOT, file).split(sep).join("/");
  const findings: Finding[] = [];

  lines.forEach((line, idx) => {
    for (const rule of rules) {
      const re = new RegExp(rule.pattern.source, rule.pattern.flags.includes("g") ? rule.pattern.flags : `${rule.pattern.flags}g`);
      let m: RegExpExecArray | null;
      while ((m = re.exec(line)) !== null) {
        if (m[0].length === 0) break;
        if (looksLikeCode(line, m[0], m.index)) continue;
        findings.push({
          file: rel,
          line: idx + 1,
          label: rule.label,
          why: rule.why,
          text: line.trim().slice(0, 140),
        });
      }
    }
  });

  return findings;
}

describe("user-facing copy", () => {
  it("finds the app's .tsx files", () => {
    expect(files.length).toBeGreaterThan(100);
  });

  it(
    "prints no internal engineering vocabulary",
    () => {
      const findings = files.flatMap((file) => scan(file));
      const report = findings
        .map((f) => `apps/web/${f.file}:${f.line}  [${f.label}] ${f.why}\n    ${f.text}`)
        .join("\n");
      expect(report, `\n${findings.length} banned phrase(s) in user-visible copy:\n${report}\n`).toBe("");
    },
    // Reads product .tsx plus related-copy / help modules. Under 4 s alone;
    // keep a 60 s ceiling so a typecheck running beside it cannot turn green
    // copy into a timeout.
    60_000,
  );

  it(
    "never tells the reader to Select a team or Select an event",
    () => {
      const all = ROOTS.flatMap((root) => collectSource(root));
      const findings = all.flatMap((file) => scan(file, SELECT_RULES));
      const report = findings
        .map((f) => `apps/web/${f.file}:${f.line}  [${f.label}] ${f.why}\n    ${f.text}`)
        .join("\n");
      expect(report, `\n${findings.length} leftover Select-a-team phrase(s):\n${report}\n`).toBe("");
    },
    60_000,
  );
});
