import { describe, expect, it } from "vitest";
import {
  OUTREACH_CALENDAR_RELATED_INCLUDE,
  classifyOutreachCalendarShell,
  formatOutreachCalendarMetric,
  outreachCalendarNextActions,
  outreachCalendarRelatedLinks,
  outreachCalendarShellCopy,
  shouldShowOutreachCalendarSummaryTiles,
} from "./outreach-calendar-related";

describe("outreachCalendarRelatedLinks", () => {
  it("builds Impact / Media Kit / Fundraisers cross-links", () => {
    const links = outreachCalendarRelatedLinks("org-1", {
      include: [...OUTREACH_CALENDAR_RELATED_INCLUDE],
    });
    expect(links.map((l) => l.id)).toEqual(["impact", "media-kit", "fundraisers"]);
    expect(links.find((l) => l.id === "impact")?.href).toBe("/business?tab=impact&orgId=org-1");
    expect(links.find((l) => l.id === "media-kit")?.href).toBe(
      "/business?tab=media-kit&orgId=org-1",
    );
  });

  it("never uses DEMO labels or hrefs", () => {
    const blob = JSON.stringify(outreachCalendarRelatedLinks("org-1"));
    expect(blob).not.toMatch(/DEMO/i);
  });
});

describe("outreachCalendarNextActions", () => {
  it("gates on workspace when org is missing", () => {
    const actions = outreachCalendarNextActions({ orgId: null, shell: "setup" });
    expect(actions[0]?.href).toBe("/workspace");
    expect(actions[0]?.primary).toBe(true);
  });

  it("points empty shells at schedule + Impact", () => {
    const actions = outreachCalendarNextActions({
      orgId: "org-1",
      shell: "empty",
      eventCount: 0,
    });
    expect(actions[0]?.id).toBe("schedule");
    expect(actions[0]?.href).toBe("#outreach-calendar-schedule");
    expect(actions.every((a) => !a.href.toLowerCase().includes("demo"))).toBe(true);
  });
});

describe("classifyOutreachCalendarShell", () => {
  it("classifies loading / setup / empty / ready without DEMO counts", () => {
    expect(classifyOutreachCalendarShell({ loading: true })).toBe("loading");
    expect(classifyOutreachCalendarShell({ loading: false, orgId: null })).toBe("setup");
    expect(
      classifyOutreachCalendarShell({
        loading: false,
        orgId: "o1",
        status: "live",
        eventCount: 0,
      }),
    ).toBe("empty");
    expect(
      classifyOutreachCalendarShell({
        loading: false,
        orgId: "o1",
        status: "live",
        eventCount: 2,
      }),
    ).toBe("ready");
  });
});

describe("outreachCalendarShellCopy + format helpers", () => {
  it("refuses invented DEMO reach metrics", () => {
    expect(outreachCalendarShellCopy("empty").description).toMatch(/never DEMO/i);
    expect(formatOutreachCalendarMetric(12, true)).toBe("12");
    expect(shouldShowOutreachCalendarSummaryTiles(0)).toBe(false);
    expect(shouldShowOutreachCalendarSummaryTiles(1)).toBe(true);
  });
});
