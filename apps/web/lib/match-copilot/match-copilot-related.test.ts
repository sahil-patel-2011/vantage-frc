import { describe, expect, it } from "vitest";
import {
  MATCH_COPILOT_RELATED_INCLUDE,
  classifyMatchCopilotShell,
  formatMatchCopilotMetric,
  matchCopilotNextActions,
  matchCopilotRelatedLinks,
  matchCopilotShellCopy,
  shouldShowMatchCopilotSummaryTiles,
} from "./match-copilot-related";

describe("matchCopilotRelatedLinks", () => {
  it("builds Strategy / Command / FMEA cross-links", () => {
    const links = matchCopilotRelatedLinks("org-1", {
      include: [...MATCH_COPILOT_RELATED_INCLUDE],
    });
    expect(links.map((l) => l.id)).toEqual(["strategy", "command", "fmea"]);
    expect(links.find((l) => l.id === "strategy")?.href).toBe(
      "/competition?tab=strategy&orgId=org-1",
    );
    expect(links.find((l) => l.id === "command")?.href).toBe(
      "/competition?tab=command&orgId=org-1",
    );
    expect(links.find((l) => l.id === "fmea")?.href).toBe("/team?tab=fmea&orgId=org-1");
  });

  it("excludes the active surface and respects include", () => {
    const links = matchCopilotRelatedLinks("org-1", {
      active: "strategy",
      include: ["command", "batteries"],
    });
    expect(links.map((l) => l.id)).toEqual(["command", "batteries"]);
  });

  it("never uses DEMO labels or hrefs", () => {
    const blob = JSON.stringify(matchCopilotRelatedLinks("org-1"));
    expect(blob).not.toMatch(/DEMO/i);
    expect(blob).not.toMatch(/demo/i);
  });
});

describe("matchCopilotNextActions", () => {
  it("gates on workspace when org is missing", () => {
    const actions = matchCopilotNextActions({ orgId: null, shell: "setup" });
    expect(actions[0]?.href).toBe("/workspace");
    expect(actions[0]?.primary).toBe(true);
    expect(actions.some((a) => a.id === "strategy")).toBe(true);
    expect(actions.some((a) => a.id === "command")).toBe(true);
    expect(actions.some((a) => a.id === "fmea")).toBe(true);
  });

  it("setup with org points at Workspace + Command / Strategy / FMEA", () => {
    const actions = matchCopilotNextActions({ orgId: "org-1", shell: "setup" });
    expect(actions[0]?.id).toBe("workspace");
    expect(actions.some((a) => a.id === "command")).toBe(true);
    expect(actions.some((a) => a.id === "strategy")).toBe(true);
    expect(actions.some((a) => a.id === "fmea")).toBe(true);
    expect(actions.every((a) => !/\bdemo\b/i.test(`${a.label} ${a.detail}`))).toBe(true);
  });

  it("points empty briefs at generate + Strategy / Command / FMEA", () => {
    const actions = matchCopilotNextActions({
      orgId: "org-1",
      shell: "empty",
      calloutCount: 0,
    });
    expect(actions.map((a) => a.id)).toEqual(
      expect.arrayContaining(["generate", "strategy", "command", "fmea"]),
    );
    expect(actions[0]?.href).toBe("#match-copilot-callouts");
    expect(actions.every((a) => !a.href.toLowerCase().includes("demo"))).toBe(true);
  });

  it("ready briefs prioritize generate/review without DEMO metrics", () => {
    const generate = matchCopilotNextActions({
      orgId: "org-1",
      shell: "ready",
      calloutCount: 2,
      hasAiBrief: false,
    });
    expect(generate[0]?.id).toBe("generate-brief");
    expect(generate.some((a) => a.id === "strategy")).toBe(true);
    expect(generate.some((a) => a.id === "command")).toBe(true);
    expect(generate.some((a) => a.id === "fmea")).toBe(true);

    const review = matchCopilotNextActions({
      orgId: "org-1",
      shell: "ready",
      calloutCount: 3,
      hasAiBrief: true,
    });
    expect(review[0]?.id).toBe("review-callouts");
    expect(review.every((a) => !a.href.toLowerCase().includes("demo"))).toBe(true);
  });
});

describe("classifyMatchCopilotShell", () => {
  it("classifies loading / error / setup / empty / ready without DEMO counts", () => {
    expect(classifyMatchCopilotShell({ loading: true })).toBe("loading");
    expect(classifyMatchCopilotShell({ loading: false, orgId: null })).toBe("setup");
    expect(classifyMatchCopilotShell({ loading: false, orgId: "o1", fetchFailed: true })).toBe(
      "error",
    );
    expect(
      classifyMatchCopilotShell({
        loading: false,
        orgId: "o1",
        status: "setup_required",
      }),
    ).toBe("setup");
    expect(
      classifyMatchCopilotShell({
        loading: false,
        orgId: "o1",
        status: "live",
        calloutCount: 0,
      }),
    ).toBe("empty");
    expect(
      classifyMatchCopilotShell({
        loading: false,
        orgId: "o1",
        status: "live",
        calloutCount: 2,
      }),
    ).toBe("ready");
  });
});

describe("matchCopilotShellCopy + format helpers", () => {
  it("refuses invented DEMO match metrics in empty/setup copy", () => {
    for (const kind of ["empty", "setup", "error", "ready"] as const) {
      const copy = matchCopilotShellCopy(kind);
      expect(copy.title).not.toMatch(/\bDEMO\b/);
      expect(copy.description).toMatch(/never|empty|org-scoped|real|blank|invent|metrics|pre-seeded/i);
    }
    expect(matchCopilotShellCopy("empty").description).toMatch(/never DEMO/i);
    expect(matchCopilotShellCopy("setup").description).toMatch(/pre-seeded|org-scoped/i);
  });

  it("formats real counts only and hides empty summary tiles", () => {
    expect(formatMatchCopilotMetric(null, false)).toBe("…");
    expect(formatMatchCopilotMetric(3, true)).toBe("3");
    expect(formatMatchCopilotMetric(-1, true)).toBe("0");
    expect(shouldShowMatchCopilotSummaryTiles(0)).toBe(false);
    expect(shouldShowMatchCopilotSummaryTiles(2)).toBe(true);
  });
});
