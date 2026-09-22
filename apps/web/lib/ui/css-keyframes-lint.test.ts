import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Two `@keyframes` with the same name is a silent override.
 *
 * CSS has no module scope for animation names: the last definition the browser
 * parses wins, for every rule using that name anywhere in the app. I added a
 * `@keyframes lux-rise` to the bottom of `marketing.css` while building a hero
 * entrance, not realising one already existed 900 lines up — so the eight
 * other things animating with `lux-rise` quietly started moving a different
 * distance, on a page I was not looking at.
 *
 * Nothing failed. Nothing could have: the animation still ran, still had that
 * name, and still looked plausible. The only way to catch it is to count.
 */

const APP = join(__dirname, "..", "..", "app");
const WEB_ROOT = join(__dirname, "..", "..");

function cssFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === ".next") continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) cssFiles(full, out);
    else if (full.endsWith(".css")) out.push(full);
  }
  return out;
}

/** `@keyframes name {` and `@-webkit-keyframes name {`, however spaced. */
const KEYFRAMES = /@(?:-webkit-)?keyframes\s+([A-Za-z_][\w-]*)/g;

type Definition = { name: string; file: string };

function everyDefinition(): Definition[] {
  const found: Definition[] = [];
  for (const file of cssFiles(APP)) {
    const text = readFileSync(file, "utf8");
    for (const match of text.matchAll(KEYFRAMES)) {
      found.push({ name: match[1] as string, file: relative(WEB_ROOT, file).replace(/\\/g, "/") });
    }
  }
  return found;
}

describe("animation names are unique across the app", () => {
  const definitions = everyDefinition();

  it("found the keyframes at all", () => {
    // Guards the guard: an empty list would pass the real check forever.
    expect(definitions.length).toBeGreaterThan(10);
    expect(definitions.some((entry) => entry.name === "lux-rise")).toBe(true);
  });

  it("defines each animation exactly once", () => {
    const byName = new Map<string, string[]>();
    for (const { name, file } of definitions) {
      byName.set(name, [...(byName.get(name) ?? []), file]);
    }

    const duplicated = [...byName.entries()]
      .filter(([, files]) => files.length > 1)
      // A `-webkit-` twin of the same name in the same file is a prefix pair,
      // not a second animation.
      .filter(([, files]) => new Set(files).size > 1 || files.length > 2)
      .map(([name, files]) => `${name} (${[...new Set(files)].join(", ")})`);

    expect(
      duplicated,
      `these animation names are defined more than once, so the last one parsed silently wins for every rule using it: ${duplicated.join("; ")}`,
    ).toEqual([]);
  });
});
