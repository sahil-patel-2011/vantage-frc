/**
 * R4 for empty/setup shells: the empty card itself has one primary control.
 * Related destinations stay in the hub strip and Next actions — not as a wall
 * of sibling buttons on the empty card.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { isPrimaryControl } from "./primary-control";

const APP_ROOT = join(__dirname, "..", "..", "app");
const EMPTY_OPEN = '{shell === "empty" ? (';
const SETUP_OPEN = '{shell === "setup" ? (';

function collectClients(dir: string, acc: string[] = []): string[] {
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
    if (stats.isDirectory()) collectClients(full, acc);
    else if (entry.endsWith("-client.tsx")) acc.push(full);
  }
  return acc;
}

function skipString(src: string, i: number): number {
  const q = src[i];
  i += 1;
  while (i < src.length) {
    if (src[i] === "\\") {
      i += 2;
      continue;
    }
    if (src[i] === q) return i + 1;
    i += 1;
  }
  return i;
}

function matchingParen(src: string, openIdx: number): number | null {
  let depth = 0;
  let i = openIdx;
  while (i < src.length) {
    const c = src[i];
    if (c === '"' || c === "'" || c === "`") {
      i = skipString(src, i);
      continue;
    }
    if (c === "(") depth += 1;
    else if (c === ")") {
      depth -= 1;
      if (depth === 0) return i;
    }
    i += 1;
  }
  return null;
}

const CONTROL = /<(a|button)\b[\s\S]*?<\/\1>/g;

function topLevelControls(inner: string): string[] | null {
  const tags: string[] = [];
  let i = 0;
  const text = inner.trim();
  const body = text.startsWith("<>") && text.endsWith("</>") ? text.slice(2, -3) : inner;
  i = 0;
  while (i < body.length) {
    while (i < body.length && /\s/.test(body[i] ?? "")) i += 1;
    if (i >= body.length) break;
    if (body[i] !== "<") return null;
    CONTROL.lastIndex = i;
    const m = CONTROL.exec(body);
    if (!m || m.index !== i) return null;
    tags.push(m[0]);
    i = m.index + m[0].length;
  }
  return tags.length ? tags : null;
}

function classNameOf(tag: string): string {
  const m = /className="([^"]*)"/.exec(tag);
  return m?.[1] ?? "";
}

function parenBlocks(src: string, marker: string): string[] {
  const blocks: string[] = [];
  let from = 0;
  while (true) {
    const at = src.indexOf(marker, from);
    if (at < 0) break;
    const open = at + marker.length - 1;
    const close = matchingParen(src, open);
    if (close == null) break;
    blocks.push(src.slice(open + 1, close));
    from = close + 1;
  }
  return blocks;
}

const clients = collectClients(APP_ROOT);

describe("empty-state R4 (one primary on the empty card)", () => {
  it("finds product clients", () => {
    expect(clients.length).toBeGreaterThan(80);
  });

  it("empty shells that are only buttons keep a single primary control", () => {
    const problems: string[] = [];
    for (const file of clients) {
      const src = readFileSync(file, "utf8");
      for (const inner of parenBlocks(src, EMPTY_OPEN)) {
        const tags = topLevelControls(inner);
        if (!tags) continue;
        if (tags.length > 1) {
          problems.push(`${file} empty card has ${tags.length} sibling controls`);
          continue;
        }
        const cls = classNameOf(tags[0] ?? "");
        if (!isPrimaryControl(cls)) {
          problems.push(`${file} empty card control is not primary: className="${cls}"`);
        }
      }
    }
    expect(problems, problems.join("\n")).toEqual([]);
  });

  it("setup shells that are a single link mark that link primary", () => {
    const problems: string[] = [];
    for (const file of clients) {
      const src = readFileSync(file, "utf8");
      for (const inner of parenBlocks(src, SETUP_OPEN)) {
        const tags = topLevelControls(inner);
        if (!tags || tags.length !== 1) continue;
        if (!tags[0]?.startsWith("<a")) continue;
        const cls = classNameOf(tags[0]);
        if (!isPrimaryControl(cls)) {
          problems.push(`${file} setup CTA is not primary: className="${cls}"`);
        }
      }
    }
    expect(problems, problems.join("\n")).toEqual([]);
  });
});
