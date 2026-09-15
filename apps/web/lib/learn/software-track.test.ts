import { describe, expect, it } from "vitest";
import { expectPlainCopy } from "../ui/copy-assertions";
import {
  SOFTWARE_TRACK_PAGE_DESCRIPTION,
  SOFTWARE_TRACK_REQUIRED_IDS,
  SOFTWARE_TRACK_UNITS,
  nextRequiredId,
  requiredDoneCount,
} from "./software-track";

const INTERNAL = new Set(["/dev-setup", "/code", "/tuning-autopilot", "/learn/6925"]);
const OFFICIAL_HOSTS = new Set([
  "docs.wpilib.org",
  "www.firstinspires.org",
  "firstinspires.org",
  "choreo.autos",
  "www.choreo.autos",
  "docs.photonvision.org",
]);

const BANNED_CHROME = /Lovat|Highlander|8033/i;

function hrefAllowed(href: string): boolean {
  if (INTERNAL.has(href)) return true;
  try {
    const url = new URL(href);
    return url.protocol === "https:" && OFFICIAL_HOSTS.has(url.hostname);
  } catch {
    return false;
  }
}

function studentChrome(unit: (typeof SOFTWARE_TRACK_UNITS)[number]): string[] {
  return [unit.title, unit.blurb, ...unit.hrefs.map((link) => link.label)];
}

describe("software track", () => {
  it("requires the prefix from 1.1 through 3.1", () => {
    expect(SOFTWARE_TRACK_REQUIRED_IDS).toEqual([
      "1.1",
      "1.2",
      "1.3",
      "2.1",
      "2.2",
      "2.3",
      "2.4",
      "2.5",
      "2.6",
      "2.7",
      "2.8",
      "2.9",
      "2.10",
      "2.11",
      "3.1",
    ]);
    expect(SOFTWARE_TRACK_UNITS.find((unit) => unit.id === "3.1")?.required).toBe(true);
    expect(SOFTWARE_TRACK_UNITS.find((unit) => unit.id === "3.2")?.required).toBe(false);
    expect(SOFTWARE_TRACK_UNITS.at(-1)?.nextId).toBeNull();
  });

  it("counts required checkoffs and names the next required unit", () => {
    expect(requiredDoneCount([])).toBe(0);
    expect(nextRequiredId([])).toBe("1.1");
    expect(requiredDoneCount(["1.1", "1.2", "3.6"])).toBe(2);
    expect(nextRequiredId(["1.1", "1.2"])).toBe("1.3");
    expect(requiredDoneCount(["3.2", "3.6"])).toBe(0);
    expect(nextRequiredId(["3.2"])).toBe("1.1");
    expect(requiredDoneCount(SOFTWARE_TRACK_REQUIRED_IDS)).toBe(SOFTWARE_TRACK_REQUIRED_IDS.length);
    expect(nextRequiredId(SOFTWARE_TRACK_REQUIRED_IDS)).toBeNull();
  });

  it("uses official https docs or the listed internal paths", () => {
    for (const unit of SOFTWARE_TRACK_UNITS) {
      expect(unit.hrefs.length, unit.id).toBeGreaterThan(0);
      for (const link of unit.hrefs) {
        expect(hrefAllowed(link.href), `${unit.id} ${link.href}`).toBe(true);
      }
    }
  });

  it("keeps student chrome free of banned product names", () => {
    expect(SOFTWARE_TRACK_PAGE_DESCRIPTION).not.toMatch(BANNED_CHROME);
    expectPlainCopy(SOFTWARE_TRACK_PAGE_DESCRIPTION);
    for (const unit of SOFTWARE_TRACK_UNITS) {
      expect(unit.blurb.split(/(?<=[.!?])\s+/).filter(Boolean).length, unit.id).toBeLessThanOrEqual(2);
      expectPlainCopy(unit.blurb);
      for (const text of studentChrome(unit)) {
        expect(text, text).not.toMatch(BANNED_CHROME);
      }
    }
  });
});
