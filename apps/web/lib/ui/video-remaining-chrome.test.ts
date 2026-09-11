/**
 * Remaining /video-analysis student chrome after Match video paste-and-confirm
 * (`/video`) landed on main. Live-org paste keeps one Analyze this video;
 * empty EmptyState is copy only. Stayed off /video, web-performance, and
 * freebuff.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  videoAnalysisSetupSteps,
  videoAnalysisShellCopy,
} from "../video-analysis/video-analysis-related";
import { offlineCapableLabel } from "../offline/shell-routes";

const WEB = join(__dirname, "..", "..");

const FILES = [
  "app/video-analysis/video-analysis-client.tsx",
  "app/video-analysis/video-analysis-chrome.tsx",
  "app/video-analysis/video-analysis-queue.tsx",
  "lib/video-analysis/video-analysis-related.ts",
  "app/api/video-analysis/route.ts",
] as const;

function emptyStates(src: string): { tag: string; inner: string }[] {
  const blocks: { tag: string; inner: string }[] = [];
  let from = 0;
  while (true) {
    const start = src.indexOf("<EmptyState", from);
    if (start < 0) break;
    const tagEnd = src.indexOf(">", start);
    if (tagEnd < 0) break;
    const opening = src.slice(start, tagEnd + 1);
    if (opening.endsWith("/>")) {
      blocks.push({ tag: opening, inner: "" });
      from = tagEnd + 1;
      continue;
    }
    const close = src.indexOf("</EmptyState>", tagEnd);
    if (close < 0) break;
    blocks.push({ tag: src.slice(start, tagEnd + 1), inner: src.slice(tagEnd + 1, close) });
    from = close + 1;
  }
  return blocks;
}

describe("remaining video-analysis student chrome", () => {
  it("does not print leftover Setup required / Pair a video Pi / video jobs / TBA acronym", () => {
    for (const rel of FILES) {
      const src = readFileSync(join(WEB, rel), "utf8");
      expect(src, rel).not.toMatch(/Setup required/);
      expect(src, rel).not.toMatch(/Pair a video Pi/);
      expect(src, rel).not.toMatch(/video jobs/);
      expect(src, rel).not.toMatch(/Pick a team first/);
      expect(src, rel).not.toMatch(/Analyze video/);
      expect(src, rel).not.toMatch(/primary-action/);
      expect(src, rel).not.toMatch(/fetchFailed \|\| !view/);
      expect(src, rel).not.toMatch(/fetchFailed \|\| view == null/);
      if (rel !== "lib/video-analysis/video-analysis-related.ts") {
        expect(src, rel).not.toMatch(/\bTBA\b/);
      }
    }
  });

  it("live-org primary is one Analyze this video on the paste form", () => {
    const client = readFileSync(join(WEB, "app/video-analysis/video-analysis-client.tsx"), "utf8");
    const queue = readFileSync(join(WEB, "app/video-analysis/video-analysis-queue.tsx"), "utf8");
    const chrome = readFileSync(join(WEB, "app/video-analysis/video-analysis-chrome.tsx"), "utf8");

    expect(queue.match(/Analyze this video/g) ?? []).toHaveLength(1);
    expect(client).not.toMatch(/Analyze this video/);
    expect(chrome).not.toMatch(/Analyze this video/);
    expect(queue).toMatch(/FormRow/);
    expect(queue).toMatch(/formatVideoSourceRef/);
    expect(queue).not.toMatch(/min behind/);
    expect(queue).not.toMatch(/job\.sourceRef/);
    expect(client).not.toMatch(/href="#video-paste"/);

    const emptyAt = client.indexOf('shell === "empty" ? (');
    expect(emptyAt).toBeGreaterThan(-1);
    const emptyBlock = client.slice(emptyAt, client.indexOf(") : (", emptyAt));
    expect(emptyBlock).not.toMatch(/<Button\b/);
    expect(emptyBlock).not.toMatch(/Analyze this video/);

    expect(videoAnalysisShellCopy("setup").badge).toBe("Needs setup");
    expect(videoAnalysisShellCopy("empty").title).toBe("Paste a match or pit video");
    expect(offlineCapableLabel("/video-analysis")).toBe("Video");
  });

  it("setup EmptyState keeps one Choose your team; last snapshot uses useOfflineSnapshot", () => {
    const client = readFileSync(join(WEB, "app/video-analysis/video-analysis-client.tsx"), "utf8");
    const chrome = readFileSync(join(WEB, "app/video-analysis/video-analysis-chrome.tsx"), "utf8");

    expect(client).toMatch(/useOfflineSnapshot<VideoAnalysisSnapshot>\("video-analysis"/);
    expect(client).toMatch(/FEATURE_API_TIMEOUT_MS/);
    expect(client).toMatch(/shell === "ready" \? <VideoNextActionsPanel/);
    expect(chrome).toMatch(/title="Video"/);
    expect(videoAnalysisSetupSteps(null)[0]?.label).toBe("Choose your team");
    expect(chrome).toMatch(/\{setup\.label\}/);

    const chromeCards = emptyStates(chrome);
    expect(chromeCards.length).toBeGreaterThan(0);
    expect(chromeCards[0]?.inner).toMatch(/\{setup \?/);
    expect(chromeCards[0]?.inner).toMatch(/variant="primary"/);
    expect(chromeCards[0]?.inner).toMatch(/\{setup\.label\}/);
  });
});
