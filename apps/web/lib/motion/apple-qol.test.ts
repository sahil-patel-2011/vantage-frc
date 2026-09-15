import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  QOL_FOCUS_PX,
  QOL_MS,
  QOL_PRESS,
  QOL_RISE_PX,
  QOL_TILE_RISE_PX,
  parseQolReduced,
  qolClassNames,
  qolLevelFromPreference,
  qolStaggerMs,
  qolStyleVars,
  qolTokens,
} from "./apple-qol";

describe("apple-qol", () => {
  it("turns reduce into zero-duration tokens so the UI does not animate", () => {
    const tokens = qolTokens("reduce");
    expect(tokens.durationMs).toBe(0);
    expect(tokens.risePx).toBe(0);
    expect(tokens.tileRisePx).toBe(0);
    expect(tokens.focusPx).toBe(0);
    expect(tokens.press).toBe(1);
    expect(qolStaggerMs(4, "reduce")).toBe(0);
    expect(qolClassNames("reduce")).toEqual({ page: "", lift: "", press: "" });
  });

  it("keeps full motion short, small, and spring-less", () => {
    const tokens = qolTokens("full");
    expect(tokens.durationMs).toBe(QOL_MS);
    expect(tokens.durationMs).toBeLessThan(400);
    expect(tokens.risePx).toBe(QOL_RISE_PX);
    expect(tokens.risePx).toBeLessThanOrEqual(8);
    expect(tokens.tileRisePx).toBe(QOL_TILE_RISE_PX);
    expect(tokens.tileRisePx).toBeLessThan(tokens.risePx);
    expect(tokens.focusPx).toBe(QOL_FOCUS_PX);
    expect(tokens.press).toBe(QOL_PRESS);
    expect(qolStaggerMs(2, "full")).toBe(56);
    expect(qolStyleVars(tokens)["--qol"]).toBe("240ms");
    expect(qolStyleVars(tokens)["--qol-tile-rise"]).toBe("3px");
    expect(qolClassNames("full").lift).toBe("qol-lift");
  });

  it("loads QoL chrome from product-styles, not the marketing layout", () => {
    const styles = readFileSync(join(__dirname, "..", "..", "app", "product-styles.ts"), "utf8");
    const layout = readFileSync(join(__dirname, "..", "..", "app", "layout.tsx"), "utf8");
    expect(styles).toMatch(/apple-qol\.css/);
    expect(layout).not.toMatch(/apple-qol\.css/);
  });

  it("reads the prefers-reduced-motion media value", () => {
    expect(parseQolReduced("reduce")).toBe(true);
    expect(qolLevelFromPreference(true)).toBe("reduce");
    expect(qolLevelFromPreference(false)).toBe("full");
  });

  it("lifts only interactive tiles and focuses sign-in fields", () => {
    const css = readFileSync(join(__dirname, "..", "..", "app", "apple-qol.css"), "utf8");
    expect(css).toMatch(/a\.app-card:hover/);
    expect(css).toMatch(/\.dash-widget-hit:hover \.dash-widget/);
    expect(css).toMatch(/\.signin-field:focus-within/);
    expect(css).toMatch(/prefers-reduced-motion: reduce/);
    expect(css).toMatch(/\.qol-stagger-row/);
    expect(css).toMatch(/--qol-stagger/);
    expect(css).toMatch(/--qol-hairline/);
    expect(css).toMatch(/\.intel-win-result/);
    expect(css).toMatch(/\.intel-win-bar i/);
    expect(css).not.toMatch(/body\.has-app-shell \.app-card:hover \{\s*transform: translateY/);
  });

  it("presses intel lookup tiles and phase chips, and reduce kills the detail pane", () => {
    const css = readFileSync(join(__dirname, "..", "..", "app", "apple-qol.css"), "utf8");
    const intel = readFileSync(join(__dirname, "..", "..", "app", "intel", "intel.css"), "utf8");
    const board = readFileSync(join(__dirname, "..", "..", "app", "intel", "intel-lookup-board.tsx"), "utf8");
    expect(css).toMatch(/\.app-button:focus-visible/);
    expect(css).toMatch(/\.app-button\.primary:not\(:disabled\):not\(\[aria-disabled="true"\]\):hover/);
    expect(css).toMatch(/\.intel-lookup-tile:hover/);
    expect(css).toMatch(/\.intel-lookup-tile:active/);
    expect(css).toMatch(/\.intel-phase:not\(:disabled\):active/);
    expect(css).toMatch(/scale\(var\(--qol-press\)\)/);
    expect(css).toMatch(/--qol-tile-rise/);
    expect(board).toMatch(/qol-stagger-row/);
    expect(board).toMatch(/--qol-i/);
    const reduceAt = css.indexOf("prefers-reduced-motion: reduce");
    expect(reduceAt).toBeGreaterThan(-1);
    expect(css.slice(reduceAt)).toMatch(/\.intel-lookup-detail/);
    expect(intel).toMatch(/intel-lookup-detail/);
    const intelReduceAt = intel.indexOf("prefers-reduced-motion: reduce");
    expect(intelReduceAt).toBeGreaterThan(-1);
    expect(intel.slice(intelReduceAt)).toMatch(/intel-lookup-detail/);
  });
});
