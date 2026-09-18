import { describe, expect, it } from "vitest";
import {
  CAD_COMMUNITY_LINKS,
  CAD_REFERENCE,
  CAD_TRACK,
  allCadLinks,
  allLessonIds,
  allLessons,
  gradableLessons,
  lessonById,
  totalCadMinutes,
} from "./track";

describe("cad learning track", () => {
  it("has no duplicate lesson ids", () => {
    const ids = allLessonIds();
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("gives every lesson a why, something to build, and a way to tell it worked", () => {
    // A lesson with no verification is how a student spends an evening on a
    // part that was wrong from the second feature.
    for (const lesson of allLessons()) {
      expect(lesson.why.trim().length, `${lesson.id} needs a why`).toBeGreaterThan(40);
      expect(lesson.steps.length, `${lesson.id} needs steps`).toBeGreaterThan(2);
      expect(lesson.practice.trim().length, `${lesson.id} needs something to build`).toBeGreaterThan(15);
      expect(lesson.verify.trim().length, `${lesson.id} needs a verify`).toBeGreaterThan(15);
      expect(lesson.links.length, `${lesson.id} needs at least one link`).toBeGreaterThan(0);
      expect(lesson.minutes, `${lesson.id} needs a realistic duration`).toBeGreaterThan(5);
    }
  });

  it("gives every lesson exactly one primary link to open first", () => {
    for (const lesson of allLessons()) {
      const primary = lesson.links.filter((link) => link.primary);
      expect(primary.length, `${lesson.id} primary links`).toBe(1);
    }
  });

  it("uses https for every link and never a bare http one", () => {
    for (const link of allCadLinks()) {
      expect(link.href.startsWith("https://"), `${link.href} must be https`).toBe(true);
    }
  });

  it("does not link thecadvideotutor, which does not resolve", () => {
    // Named as a source by the product owner. thecadvideotutor.com fails DNS
    // and the YouTube handle 404s, so it cannot be linked at all. Pinned so it
    // cannot be re-added from memory.
    const links = allCadLinks().map((link) => link.href.toLowerCase());
    for (const dead of ["thecadvideotutor", "cadvideotutor"]) {
      expect(links.some((href) => href.includes(dead)), dead).toBe(false);
    }
  });

  it("never uses a flat Onshape help path, which 200s even when it does not exist", () => {
    // cad.onshape.com serves HTTP 200 for ANY path under /help/Content/ — a
    // made-up topic renders the generic "Onshape Help" landing page with a 200.
    // So a status check alone cannot catch a dead help link there. The
    // canonical form is /help/Content/<Section>/<topic>.htm, and every one of
    // those below was verified by fetching it and reading its <title>.
    for (const link of allCadLinks()) {
      if (!link.href.includes("cad.onshape.com/help/")) continue;
      const path = link.href.split("/help/Content/")[1] ?? "";
      expect(path.includes("/"), `${link.href} must use the /Content/<Section>/<topic>.htm form`).toBe(true);
    }
  });

  it("does not contain the plausible Onshape help URLs that silently fall back", () => {
    // Every one of these returns 200 and renders the generic help landing page
    // instead of the topic it names. They are exactly what you would guess.
    const fallbacks = [
      "/help/Content/planes.htm",
      "/help/Content/massproperties.htm",
      "/help/Content/materials.htm",
      "/help/Content/partstudios.htm",
      "/help/Content/incontext.htm",
      "/help/Content/sketchbasics.htm",
    ];
    const links = allCadLinks().map((link) => link.href);
    for (const dead of fallbacks) {
      expect(links.some((href) => href.includes(dead)), dead).toBe(false);
    }
  });

  it("teaches single parts before multi-part and assemblies", () => {
    const order = CAD_TRACK.map((unit) => unit.id);
    expect(order.indexOf("sketching")).toBeLessThan(order.indexOf("solids"));
    expect(order.indexOf("solids")).toBeLessThan(order.indexOf("part-studios"));
    expect(order.indexOf("part-studios")).toBeLessThan(order.indexOf("multi-part"));
    expect(order[order.length - 1]).toBe("graded");
  });

  it("covers every topic the track promises", () => {
    const ids = allLessonIds();
    for (const required of [
      "interface", // navigating the Onshape UI
      "sketch-basics",
      "constraints",
      "planes", // planes and datums
      "extrude",
      "revolve",
      "fillets-chamfers",
      "part-studio",
      "in-context",
      "assemblies",
      "mates",
    ]) {
      expect(ids, `missing lesson: ${required}`).toContain(required);
    }
  });

  it("teaches the material the grader assumes, in the lesson and not only the UI", () => {
    // Mass and MOI are both linear in density, so a student on the wrong
    // material gets two meaningless numbers. The track has to say so.
    const material = lessonById("material");
    expect(material).toBeDefined();
    expect(material!.steps.join(" ").toUpperCase()).toContain("CAST IRON");
    expect(material!.why.toLowerCase()).toContain("cast iron");
  });

  it("marks the graded lesson and tells students what happens when grading fails", () => {
    const gradable = gradableLessons();
    expect(gradable.length).toBeGreaterThan(0);
    for (const lesson of gradable) {
      expect(lesson.warning, `${lesson.id} must say what a failed read means`).toBeTruthy();
      expect(lesson.warning!.toLowerCase()).toContain("graded nothing");
      expect(`${lesson.steps.join(" ")} ${lesson.why}`.toLowerCase()).toContain("cast iron");
    }
  });

  it("is a real track, not a stub", () => {
    expect(allLessonIds().length).toBeGreaterThan(10);
    expect(totalCadMinutes()).toBeGreaterThan(300);
    for (const unit of CAD_TRACK) {
      expect(unit.lessons.length, `${unit.id} has no lessons`).toBeGreaterThan(0);
      expect(unit.blurb.trim().length, `${unit.id} needs a blurb`).toBeGreaterThan(30);
    }
  });

  it("keeps the reference table to jobs and tools, not invented shortcuts", () => {
    // Onshape's keyboard shortcuts differ by platform and change between
    // releases; a wrong shortcut in a reference table is worse than no table.
    expect(CAD_REFERENCE.length).toBeGreaterThan(3);
    for (const group of CAD_REFERENCE) {
      expect(group.rows.length).toBeGreaterThan(1);
      for (const row of group.rows) {
        expect(row.want.trim()).not.toBe("");
        expect(row.tool.trim()).not.toBe("");
        expect(row.tool, `${row.want} looks like a keyboard shortcut`).not.toMatch(/\b(ctrl|cmd|alt|shift)\s*\+/i);
      }
    }
  });

  it("keeps a community fallback for when the track runs out", () => {
    expect(CAD_COMMUNITY_LINKS.length).toBeGreaterThan(2);
    expect(CAD_COMMUNITY_LINKS.some((link) => link.href.includes("learn.onshape.com"))).toBe(true);
    expect(CAD_COMMUNITY_LINKS.some((link) => link.href.includes("forum.onshape.com"))).toBe(true);
  });

  it("resolves a lesson by id and nothing by a made-up one", () => {
    expect(lessonById("extrude")?.title).toContain("Extrude");
    expect(lessonById("not-a-lesson")).toBeUndefined();
  });
});
