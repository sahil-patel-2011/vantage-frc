import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { offlineCapableLabel } from "../offline/shell-routes";

const WEB = join(__dirname, "..", "..");

/**
 * Student Season Goals / Morning standup / Meeting agenda chrome — not
 * leftover-product copy, remaining boards, or the testing-week Playwright
 * timeout slice.
 */
const FILES = [
  "app/goals-tracker/goals-tracker-client.tsx",
  "app/goals-tracker/page.tsx",
  "app/standup-digest/standup-digest-client.tsx",
  "app/standup-digest/page.tsx",
  "app/meeting-autopilot/meeting-autopilot-client.tsx",
  "app/meeting-autopilot/page.tsx",
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
  const empty = src.indexOf('case "empty"', start);
  const ends = [live, empty].filter((index) => index > start);
  const end = ends.length > 0 ? Math.min(...ends) : src.length;
  return src.slice(start, end);
}

describe("Season Goals / standup / meeting agenda student chrome", () => {
  it("does not print Setup required or Meeting-agenda autopilot on this slice", () => {
    for (const rel of FILES) {
      const src = readFileSync(join(WEB, rel), "utf8");
      expect(src, rel).not.toMatch(/Setup required/);
      expect(src, rel).not.toMatch(/Meeting-agenda autopilot/);
      expect(src, rel).not.toMatch(/VANTAGE \//);
      expect(src, rel).not.toMatch(/primary-action/);
      expect(src, rel).not.toMatch(/fetchFailed \|\| !view/);
      expect(src, rel).not.toMatch(/fetchFailed \|\| view == null/);
    }
  });

  it("setup is Needs setup with one EmptyState primary; last snapshot uses if (!view)", () => {
    const goals = readFileSync(join(WEB, "app/goals-tracker/goals-tracker-client.tsx"), "utf8");
    const standup = readFileSync(join(WEB, "app/standup-digest/standup-digest-client.tsx"), "utf8");
    const meeting = readFileSync(join(WEB, "app/meeting-autopilot/meeting-autopilot-client.tsx"), "utf8");

    expect(goals).toMatch(/title="Season Goals"/);
    expect(standup).toMatch(/title="Morning standup"/);
    expect(meeting).toMatch(/title="Meeting agenda"/);
    expect(goals).toMatch(/badge="Needs setup"/);
    expect(standup).toMatch(/badge="Needs setup"/);
    expect(meeting).toMatch(/Needs setup/);

    for (const src of [goals, standup, meeting]) {
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

    expect(offlineCapableLabel("/goals-tracker")).toBe("Season Goals");
    expect(offlineCapableLabel("/standup-digest")).toBe("Morning standup");
    expect(offlineCapableLabel("/meeting-autopilot")).toBe("Meeting agenda");
  });

  it("header related stays Hours / Standup / Season Goals / Meeting agenda / Calendar", () => {
    const goals = readFileSync(join(WEB, "app/goals-tracker/goals-tracker-client.tsx"), "utf8");
    const standup = readFileSync(join(WEB, "app/standup-digest/standup-digest-client.tsx"), "utf8");
    const meeting = readFileSync(join(WEB, "app/meeting-autopilot/meeting-autopilot-client.tsx"), "utf8");
    expect(goals).toMatch(/>Standup</);
    expect(goals).toMatch(/>Meeting agenda</);
    expect(standup).toMatch(/>Season Goals</);
    expect(standup).toMatch(/>Meeting agenda</);
    expect(meeting).toMatch(/>Calendar</);
    expect(meeting).toMatch(/>Standup</);
    expect(meeting).toMatch(/>Season Goals</);
  });
});
