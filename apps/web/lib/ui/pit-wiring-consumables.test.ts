/**
 * Pit wiring / consumables student chrome — not Event day packing.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { offlineCapableLabel } from "../offline/shell-routes";

const WEB = join(__dirname, "..", "..");

const FILES = [
  "app/wiring/wiring-client.tsx",
  "app/wiring-diagnoser/wiring-diagnoser-client.tsx",
  "app/spares/spares-client.tsx",
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

describe("Pit wiring / consumables student chrome", () => {
  it("does not print Setup required or blank a painted board", () => {
    for (const rel of FILES) {
      const src = readFileSync(join(WEB, rel), "utf8");
      expect(src, rel).not.toMatch(/Setup required/);
      expect(src, rel).not.toMatch(/VANTAGE \//);
      expect(src, rel).not.toMatch(/primary-action/);
      expect(src, rel).not.toMatch(/fetchFailed \|\| !view/);
      expect(src, rel).not.toMatch(/fetchFailed \|\| view == null/);
      expect(src, rel).toMatch(/if \(!view\)/);
      expect(src, rel).toMatch(/getFeatureSnapshot/);
      expect(src, rel).toMatch(/putFeatureSnapshot/);
    }
  });

  it("setup keeps Needs setup and one Choose your team primary", () => {
    for (const rel of FILES) {
      const src = readFileSync(join(WEB, rel), "utf8");
      expect(src).toMatch(/badge="Needs setup"/);
      const setupCards = emptyStates(src).filter((block) => /Needs setup/.test(`${block.tag}${block.inner}`));
      expect(setupCards.length).toBeGreaterThan(0);
      for (const card of setupCards) {
        expect(card.inner.match(/<Button\b/g) ?? []).toHaveLength(1);
        expect(card.inner).toMatch(/variant="primary"/);
      }
    }
    expect(offlineCapableLabel("/wiring")).toBe("CAN-bus map");
    expect(offlineCapableLabel("/wiring-diagnoser")).toBe("Wiring check");
    expect(offlineCapableLabel("/spares")).toBe("Consumables");
  });
});
