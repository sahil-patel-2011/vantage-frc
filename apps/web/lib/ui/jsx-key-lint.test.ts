/**
 * List lint: anything rendered from `.map()` carries a React key.
 *
 * Every feature has a "related tools" strip, and the strip was written once and
 * pasted into ninety-four files — all of them without a key. React then
 * re-creates the anchors on every render instead of moving them, so focus lands
 * back at the top of the strip mid-keyboard-navigation, and the console fills
 * with key warnings that bury the errors worth reading.
 *
 * `eslint-plugin-react` is not a dependency here, so `react/jsx-key` is not
 * available to catch it. This scans instead, the same way `copy-lint.test.ts`
 * scans for engineering vocabulary.
 *
 * Deliberately narrow: it only looks at a `.map(...)` whose arrow opens a JSX
 * element on the very next line. Multi-line element heads, `.map()` returning a
 * variable, and fragments with a key on an inner node are out of scope — this
 * is a guard against the paste, not a general React linter.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const WEB_ROOT = join(__dirname, "..", "..");
const ROOTS = [join(WEB_ROOT, "app"), join(WEB_ROOT, "components")];

/** `.map((x) => (` / `.map(x => (` — an arrow that opens a JSX block. */
const MAP_OPENS_JSX = /\.map\(\s*\(?[A-Za-z_$][\w$]*.*=>\s*\($/;
/** The opening tag of a real element. `<>` fragments cannot take a key. */
const ELEMENT_OPEN = /^<[A-Za-z]/;

function tsxFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules") continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) tsxFiles(full, out);
    else if (full.endsWith(".tsx")) out.push(full);
  }
  return out;
}

function missingKeySites(file: string): string[] {
  const lines = readFileSync(file, "utf8").split(/\r?\n/);
  const found: string[] = [];
  for (let i = 0; i < lines.length - 1; i += 1) {
    if (!MAP_OPENS_JSX.test(lines[i] as string)) continue;
    const next = (lines[i + 1] as string).trim();
    if (!ELEMENT_OPEN.test(next)) continue;
    // The tag can wrap; gather it up to the closing angle bracket.
    let tag = next;
    for (let j = i + 2; !tag.includes(">") && j < i + 10 && j < lines.length; j += 1) {
      tag += ` ${(lines[j] as string).trim()}`;
    }
    if (!/\bkey=/.test(tag)) {
      found.push(`${relative(WEB_ROOT, file)}:${i + 2}  ${next.slice(0, 80)}`);
    }
  }
  return found;
}

describe("every mapped list element has a key", () => {
  it("finds none in app/ or components/", () => {
    const offenders = ROOTS.flatMap((root) => tsxFiles(root)).flatMap(missingKeySites);
    // Named in the failure so the fix is one file open, not a hunt.
    expect(offenders).toEqual([]);
  });

  it("actually detects a missing key, so an empty result means something", () => {
    // Guards the guard: if the pattern ever stops matching, the test above
    // would pass vacuously across the whole app and nobody would notice.
    const sample = ["  {links.map((link) => (", "    <a href={link.href}>{link.label}</a>", "  ))}"];
    expect(MAP_OPENS_JSX.test(sample[0] as string)).toBe(true);
    expect(/\bkey=/.test(sample[1] as string)).toBe(false);
  });
});
