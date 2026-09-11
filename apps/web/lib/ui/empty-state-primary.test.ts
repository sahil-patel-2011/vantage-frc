/**
 * R4 for empty/setup shells: the empty card itself has one primary control.
 * Related destinations stay in the hub strip and Next actions — not as a wall
 * of sibling buttons on the empty card.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { isPrimaryControl } from "./primary-control";

// Walks every *-client.tsx under app/. Beside a production build two of these
// took 5.4 s and 12.7 s and failed on the 5 s default; alone they take ~1 s.
vi.setConfig({ testTimeout: 60_000 });

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

const CONTROL = /<(a|button|Button)\b[\s\S]*?<\/\1>/g;

function topLevelControls(inner: string): string[] | null {
  const tags: string[] = [];
  const text = inner.trim();
  const body = text.startsWith("<>") && text.endsWith("</>") ? text.slice(2, -3) : inner;
  let i = 0;
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

function isPrimaryTag(tag: string): boolean {
  if (/\bvariant=["']primary["']/.test(tag)) return true;
  return isPrimaryControl(classNameOf(tag));
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
        const tag = tags[0] ?? "";
        if (!isPrimaryTag(tag)) {
          problems.push(`${file} empty card control is not primary: ${tag.slice(0, 120)}`);
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
        if (!tags[0]?.startsWith("<a") && !tags[0]?.startsWith("<Button")) continue;
        if (!isPrimaryTag(tags[0])) {
          problems.push(`${file} setup CTA is not primary: ${tags[0].slice(0, 120)}`);
        }
      }
    }
    expect(problems, problems.join("\n")).toEqual([]);
  });

  it("product UI does not paint a strategy-setup-steps checklist", () => {
    const APP = join(__dirname, "..", "..", "app");
    const hits: string[] = [];
    function walk(dir: string) {
      for (const entry of readdirSync(dir)) {
        if (entry.startsWith(".") || entry === "node_modules") continue;
        const full = join(dir, entry);
        const stats = statSync(full);
        if (stats.isDirectory()) {
          walk(full);
          continue;
        }
        if (!entry.endsWith(".tsx")) continue;
        const src = readFileSync(full, "utf8");
        if (src.includes('className="strategy-setup-steps"')) {
          hits.push(full);
        }
      }
    }
    walk(APP);
    expect(hits, hits.join("\n")).toEqual([]);
  });

  it("does not nest related strips inside EmptyState", () => {
    const hits: string[] = [];
    for (const file of clients) {
      const src = readFileSync(file, "utf8");
      let from = 0;
      while (true) {
        const start = src.indexOf("<EmptyState", from);
        if (start < 0) break;
        const tagEnd = src.indexOf(">", start);
        if (tagEnd < 0) break;
        const opening = src.slice(start, tagEnd + 1);
        if (opening.endsWith("/>")) {
          from = tagEnd + 1;
          continue;
        }
        const close = src.indexOf("</EmptyState>", tagEnd);
        if (close < 0) break;
        const inner = src.slice(tagEnd + 1, close);
        if (/<[A-Z][A-Za-z0-9]*Related\b/.test(inner)) {
          hits.push(`${file} EmptyState nests a Related strip`);
        }
        from = close + 1;
      }
    }
    expect(hits, hits.join("\n")).toEqual([]);
  });

  it("setup_required shells do not paint a Next-actions panel", () => {
    const SKIP = new Set([
      "todos-client.tsx", // PRs #4 and #7
    ]);
    const hits: string[] = [];
    const marker = 'status === "setup_required" ? (';
    for (const file of clients) {
      if (SKIP.has(file.split("/").pop() ?? "")) continue;
      const src = readFileSync(file, "utf8");
      for (const inner of parenBlocks(src, marker)) {
        if (/<[A-Z][A-Za-z0-9]*NextActions\b/.test(inner)) {
          hits.push(`${file} setup_required paints a Next-actions panel`);
        }
      }
    }
    expect(hits, hits.join("\n")).toEqual([]);
  });

  it("does not nest related strips inside EmptyState in chrome or fleet shells", () => {
    const SKIP = new Set([
      "fundraising-glance.tsx",
      "sponsor-pipeline-panel.tsx",
      "partner-placements-panel.tsx",
    ]);
    const hits: string[] = [];
    function walk(dir: string) {
      for (const entry of readdirSync(dir)) {
        if (entry.startsWith(".") || entry === "node_modules") continue;
        const full = join(dir, entry);
        const stats = statSync(full);
        if (stats.isDirectory()) {
          walk(full);
          continue;
        }
        if (!entry.endsWith(".tsx")) continue;
        if (SKIP.has(entry)) continue;
        const src = readFileSync(full, "utf8");
        let from = 0;
        while (true) {
          const start = src.indexOf("<EmptyState", from);
          if (start < 0) break;
          const tagEnd = src.indexOf(">", start);
          if (tagEnd < 0) break;
          const opening = src.slice(start, tagEnd + 1);
          if (opening.endsWith("/>")) {
            from = tagEnd + 1;
            continue;
          }
          const close = src.indexOf("</EmptyState>", tagEnd);
          if (close < 0) break;
          const inner = src.slice(tagEnd + 1, close);
          if (/<[A-Z][A-Za-z0-9]*Related\b/.test(inner)) {
            hits.push(`${full} EmptyState nests a Related strip`);
          }
          from = close + 1;
        }
      }
    }
    walk(APP_ROOT);
    expect(hits, hits.join("\n")).toEqual([]);
  });

  /**
   * JSX that still shares EmptyState's parent. Stops at the expression's
   * closing `)` so a later `return` or the other arm of a setup ternary is
   * not treated as a sibling. Leftover extra buttons were Next-actions in
   * that same parent; gold gates them on ready.
   */
  function emptyStateParentRest(src: string, close: number): string | null {
    let i = close + "</EmptyState>".length;
    const end = Math.min(src.length, i + 800);
    while (i < end) {
      while (i < end && /\s/.test(src[i] ?? "")) i += 1;
      if (i >= end) return null;
      if (src.startsWith("</>", i)) {
        i += 3;
        continue;
      }
      if (src.startsWith("</", i)) {
        const gt = src.indexOf(">", i);
        if (gt < 0 || gt >= end) return null;
        i = gt + 1;
        continue;
      }
      if (src.startsWith(") :", i) || src.startsWith(");", i) || src[i] === ")") return null;
      return src.slice(i, Math.min(src.length, i + 400));
    }
    return null;
  }

  it("Next-actions after EmptyState stay gated on ready", () => {
    const SKIP = new Set([
      "intel-client.tsx",
      "overnight-intel-client.tsx",
      "admin-client.tsx",
      "partner-placements-panel.tsx", // PR #3
    ]);
    const hits: string[] = [];
    function walk(dir: string) {
      for (const entry of readdirSync(dir)) {
        if (entry.startsWith(".") || entry === "node_modules") continue;
        const full = join(dir, entry);
        const stats = statSync(full);
        if (stats.isDirectory()) {
          walk(full);
          continue;
        }
        if (!entry.endsWith(".tsx")) continue;
        if (SKIP.has(entry)) continue;
        const src = readFileSync(full, "utf8");
        let from = 0;
        while (true) {
          const close = src.indexOf("</EmptyState>", from);
          if (close < 0) break;
          const rest = emptyStateParentRest(src, close);
          if (
            rest &&
            /<[A-Z][A-Za-z0-9]*NextActions[A-Za-z0-9]*\b/.test(rest) &&
            !/[Ss]hell === ["']ready["']/.test(rest) &&
            !/status === ["']ready["']/.test(rest) &&
            !/shell !== ["']ready["']/.test(rest)
          ) {
            hits.push(`${full} EmptyState is followed by an unguarded Next-actions panel`);
          }
          from = close + 1;
        }
      }
    }
    walk(APP_ROOT);
    expect(hits, hits.join("\n")).toEqual([]);
  });
});
