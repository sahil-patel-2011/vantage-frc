import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { PRODUCT_HUBS, hubPrimaryTabs } from "../nav/hubs";
import {
  SEASON_MOMENTS,
  SECTION_HELP,
  seasonMomentLabel,
  sectionHelpById,
  sectionHelpFor,
  sectionHelpForHub,
  sectionHelpForMoment,
} from "./section-help";

const MOMENT_IDS = new Set(SEASON_MOMENTS.map((moment) => moment.id));

describe("section help registry", () => {
  it("gives every entry a non-empty what / why / when", () => {
    for (const entry of SECTION_HELP) {
      expect(entry.title.trim().length, entry.id).toBeGreaterThan(0);
      expect(entry.what.trim().length, entry.id).toBeGreaterThan(0);
      expect(entry.why.trim().length, entry.id).toBeGreaterThan(0);
      expect(entry.when.trim().length, entry.id).toBeGreaterThan(0);
    }
  });

  it("keeps how between 1 and 5 steps and tips at 3 or fewer", () => {
    for (const entry of SECTION_HELP) {
      expect(entry.how.length, entry.id).toBeGreaterThanOrEqual(1);
      expect(entry.how.length, entry.id).toBeLessThanOrEqual(5);
      expect(entry.how.every((step) => step.trim().length > 0), entry.id).toBe(true);
      expect(entry.tips?.length ?? 0, entry.id).toBeLessThanOrEqual(3);
    }
  });

  it("points every related link at an in-app path", () => {
    for (const entry of SECTION_HELP) {
      expect(entry.related.length, entry.id).toBeGreaterThan(0);
      for (const link of entry.related) {
        expect(link.href.startsWith("/"), `${entry.id} → ${link.href}`).toBe(true);
        expect(link.label.trim().length, entry.id).toBeGreaterThan(0);
      }
    }
  });

  it("keeps ids unique and derived from hub + tab", () => {
    const ids = SECTION_HELP.map((entry) => entry.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const entry of SECTION_HELP) {
      expect(entry.id).toBe(`${entry.hub}.${entry.tab}`);
    }
  });

  it("tags every entry with known season moments", () => {
    for (const entry of SECTION_HELP) {
      expect(entry.moments.length, entry.id).toBeGreaterThan(0);
      for (const moment of entry.moments) {
        expect(MOMENT_IDS.has(moment), `${entry.id} → ${moment}`).toBe(true);
      }
    }
  });

  it("only links related hrefs that resolve to a real app route", () => {
    const appDir = resolve(dirname(fileURLToPath(import.meta.url)), "../../app");
    const dead: string[] = [];
    for (const entry of SECTION_HELP) {
      for (const link of entry.related) {
        const route = link.href.split(/[?#]/)[0].replace(/^\/+/, "");
        const page = route ? resolve(appDir, route, "page.tsx") : resolve(appDir, "page.tsx");
        if (!existsSync(page)) dead.push(`${entry.id} → ${link.href}`);
      }
    }
    expect(dead).toEqual([]);
  });

  it("never claims a metric the product refuses to invent", () => {
    for (const entry of SECTION_HELP) {
      const blob = [entry.what, entry.why, entry.when, ...entry.how, ...(entry.tips ?? [])].join(" ");
      expect(blob, entry.id).not.toMatch(/\bDEMO\b/);
    }
  });
});

describe("section help coverage", () => {
  it("covers every primary workbench tab in PRODUCT_HUBS", () => {
    const missing: string[] = [];
    for (const hub of PRODUCT_HUBS) {
      for (const tab of hubPrimaryTabs(hub)) {
        if (!sectionHelpFor(hub.id, tab.id)) missing.push(`${hub.id}.${tab.id}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it("only registers tabs that exist in their hub", () => {
    const unknown = SECTION_HELP.filter((entry) => {
      const hub = PRODUCT_HUBS.find((candidate) => candidate.id === entry.hub);
      return !hub?.tabs.some((tab) => tab.id === entry.tab);
    }).map((entry) => entry.id);
    expect(unknown).toEqual([]);
  });

  it("covers every hub and every season moment", () => {
    for (const hub of PRODUCT_HUBS) {
      expect(sectionHelpForHub(hub.id).length, hub.id).toBeGreaterThan(0);
    }
    for (const moment of SEASON_MOMENTS) {
      expect(sectionHelpForMoment(moment.id).length, moment.id).toBeGreaterThan(0);
    }
  });
});

describe("section help lookups", () => {
  it("resolves by id and by hub + tab, and misses cleanly", () => {
    expect(sectionHelpById("competition.command")?.title).toBe("Event day");
    expect(sectionHelpFor("competition", "command")?.id).toBe("competition.command");
    expect(sectionHelpFor("competition", "not-a-tab")).toBeUndefined();
    expect(sectionHelpFor(null, "command")).toBeUndefined();
    expect(sectionHelpFor("competition", null)).toBeUndefined();
  });

  it("keeps same-named tabs in different hubs distinct", () => {
    expect(sectionHelpFor("business", "impact")?.title).toBe("Impact log");
    expect(sectionHelpFor("media", "impact")?.title).toBe("Media impact");
    expect(sectionHelpFor("team", "calendar")?.id).not.toBe(sectionHelpFor("media", "calendar")?.id);
  });

  it("labels season moments", () => {
    expect(seasonMomentLabel("comp-day")).toBe("Competition day");
    expect(seasonMomentLabel("preseason")).toBe("Before season");
  });
});
