import { describe, expect, it } from "vitest";
import {
  ALLOWED_RESOURCE_HOSTS,
  CURATED_RESOURCES,
  RESOURCE_FRESHNESS_NOTE,
  resourceById,
  resourceLink,
  resourceTopics,
  resourcesFor,
  type ResourceTopic,
} from "./curated-resources";

const TOPICS: ResourceTopic[] = [
  "rookie",
  "cad",
  "programming",
  "strategy",
  "scouting",
  "business",
  "season-ops",
];

describe("curated resources registry", () => {
  it("points at something for every topic", () => {
    expect(CURATED_RESOURCES.length).toBeGreaterThanOrEqual(15);
    for (const topic of TOPICS) {
      expect(resourcesFor(topic).length, `no resources for ${topic}`).toBeGreaterThanOrEqual(2);
    }
    expect(resourceTopics().sort()).toEqual([...TOPICS].sort());
  });

  it("uses https for every URL", () => {
    for (const entry of CURATED_RESOURCES) {
      expect(entry.url.startsWith("https://"), `${entry.id} is not https`).toBe(true);
    }
  });

  it("only links hosts on the allowlist", () => {
    const allowed = new Set<string>(ALLOWED_RESOURCE_HOSTS);
    for (const entry of CURATED_RESOURCES) {
      const host = new URL(entry.url).hostname;
      expect(allowed.has(host), `${entry.id} links unlisted host ${host}`).toBe(true);
    }
  });

  it("gives every entry a real description and maintainer", () => {
    for (const entry of CURATED_RESOURCES) {
      expect(entry.title.trim().length, `${entry.id} title`).toBeGreaterThan(2);
      expect(entry.oneLine.trim().length, `${entry.id} oneLine`).toBeGreaterThan(30);
      expect(entry.maintainer.trim().length, `${entry.id} maintainer`).toBeGreaterThan(2);
    }
  });

  it("keeps ids and URLs unique", () => {
    const ids = CURATED_RESOURCES.map((entry) => entry.id);
    expect(new Set(ids).size).toBe(ids.length);
    const urls = CURATED_RESOURCES.map((entry) => entry.url);
    expect(new Set(urls).size).toBe(urls.length);
  });

  it("never lists a topic as both primary and secondary on one entry", () => {
    for (const entry of CURATED_RESOURCES) {
      expect(
        (entry.secondaryTopics ?? []).includes(entry.topic),
        `${entry.id} repeats its own topic`,
      ).toBe(false);
      const secondary = entry.secondaryTopics ?? [];
      expect(new Set(secondary).size, `${entry.id} duplicate secondary topic`).toBe(secondary.length);
    }
  });

  it("leads each topic with its primary entries", () => {
    expect(resourcesFor("cad")[0]?.id).toBe("frcdesign");
    expect(resourcesFor("programming")[0]?.id).toBe("wpilib-zero-to-robot");
    expect(resourcesFor("strategy")[0]?.id).toBe("everybot");
    expect(resourcesFor("scouting").map((entry) => entry.id)).toEqual(
      expect.arrayContaining(["the-blue-alliance", "statbotics"]),
    );
    // Secondary matches still surface, just after the primaries.
    expect(resourcesFor("rookie").map((entry) => entry.id)).toContain("everybot");
  });

  it("honours the limit argument", () => {
    expect(resourcesFor("season-ops", 2)).toHaveLength(2);
    expect(resourcesFor("cad", 0)).toHaveLength(0);
    expect(resourcesFor("cad", 99).length).toBe(resourcesFor("cad").length);
  });

  it("resolves links by id and refuses dangling references", () => {
    expect(resourceLink("frcdesign")).toEqual({
      label: "FRCDesign.org",
      url: "https://www.frcdesign.org/",
    });
    expect(() => resourceLink("not-a-resource")).toThrow(/Unknown curated resource/);
    expect(resourceById("everybot")?.topic).toBe("strategy");
    expect(resourceById("nope")).toBeUndefined();
  });

  it("says out loud that these are other people's resources", () => {
    expect(RESOURCE_FRESHNESS_NOTE).toMatch(/linked not copied/i);
  });
});
