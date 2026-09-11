import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { offlineCapableLabel } from "../offline/shell-routes";

const WEB = join(__dirname, "..", "..");

/**
 * Student Code vs match / Software versions chrome — not leftover-product
 * copy, remaining boards, or skip-list code-client.tsx last-snapshot.
 */
const FILES = [
  "app/code-perf/code-perf-client.tsx",
  "app/code-perf/page.tsx",
  "app/software-versions/software-versions-client.tsx",
  "app/software-versions/page.tsx",
] as const;

function emptyStates(src: string): { tag: string; inner: string }[] {
  const blocks: { tag: string; inner: string }[] = [];
  let from = 0;
  while (true) {
    const start = src.indexOf("<EmptyState", from);
    if (start < 0) break;
    const tagEnd = src.indexOf(">", start);
    if (tagEnd < 0) break;
    const close = src.indexOf("</EmptyState>", tagEnd);
    if (close < 0) break;
    blocks.push({ tag: src.slice(start, tagEnd + 1), inner: src.slice(tagEnd + 1, close) });
    from = close + 1;
  }
  return blocks;
}

function setupCase(src: string): string {
  const start = src.indexOf('case "setup_required"');
  expect(start).toBeGreaterThan(-1);
  const live = src.indexOf('case "live"', start);
  const ready = src.indexOf('case "ready"', start);
  const ends = [live, ready].filter((index) => index > start);
  const end = ends.length > 0 ? Math.min(...ends) : src.length;
  return src.slice(start, end);
}

describe("Code vs match / Software versions student chrome", () => {
  it("does not print Setup required or Code-vs-Match Detective on this slice", () => {
    for (const rel of FILES) {
      const src = readFileSync(join(WEB, rel), "utf8");
      expect(src, rel).not.toMatch(/Setup required/);
      expect(src, rel).not.toMatch(/Code-vs-Match Detective/);
      expect(src, rel).not.toMatch(/VANTAGE \//);
      expect(src, rel).not.toMatch(/primary-action/);
      expect(src, rel).not.toMatch(/fetchFailed \|\| !view/);
      expect(src, rel).not.toMatch(/fetchFailed \|\| view == null/);
    }
  });

  it("setup is Needs setup with one EmptyState primary; last snapshot uses if (!view)", () => {
    const codePerf = readFileSync(join(WEB, "app/code-perf/code-perf-client.tsx"), "utf8");
    const versions = readFileSync(join(WEB, "app/software-versions/software-versions-client.tsx"), "utf8");

    expect(codePerf).toMatch(/title="Code vs match"/);
    expect(versions).toMatch(/title="Software versions"/);
    expect(codePerf).toMatch(/badge="Needs setup"/);
    expect(versions).toMatch(/badge="Needs setup"/);

    for (const src of [codePerf, versions]) {
      expect(src).toMatch(/if \(!view\)/);
      expect(src).toMatch(/getFeatureSnapshot/);
      expect(src).toMatch(/putFeatureSnapshot/);
      expect(src).toMatch(/orgHint \|\| "_"/);
      expect(setupCase(src)).not.toMatch(/NextActions/);

      const setupCards = emptyStates(src).filter((block) => /Needs setup/.test(`${block.tag}${block.inner}`));
      expect(setupCards.length).toBeGreaterThan(0);
      for (const card of setupCards) {
        expect(card.inner.match(/<Button\b/g) ?? []).toHaveLength(1);
        expect(card.inner).toMatch(/variant="primary"/);
      }
    }

    expect(offlineCapableLabel("/code-perf")).toBe("Code vs match");
    expect(offlineCapableLabel("/software-versions")).toBe("Software versions");
  });

  it("header related stays Code Coach / Deploy log / CAD and CAN-bus map / Code / Tuning log", () => {
    const codePerf = readFileSync(join(WEB, "app/code-perf/code-perf-client.tsx"), "utf8");
    const versions = readFileSync(join(WEB, "app/software-versions/software-versions-client.tsx"), "utf8");
    expect(codePerf).toMatch(/>\s*Code Coach\s*</);
    expect(codePerf).toMatch(/>\s*Deploy log\s*</);
    expect(codePerf).toMatch(/>\s*CAD\s*</);
    expect(versions).toMatch(/>\s*CAN-bus map\s*</);
    expect(versions).toMatch(/>\s*Code\s*</);
    expect(versions).toMatch(/>\s*Tuning log\s*</);
  });
});
