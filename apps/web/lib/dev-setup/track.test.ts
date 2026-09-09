import { describe, expect, it } from "vitest";
import { allLinks, allStepIds, stepsForOs, totalMinutes, TRACK } from "./track";

describe("dev setup track", () => {
  it("has no duplicate step ids", () => {
    const ids = TRACK.flatMap((stage) => stage.steps.map((step) => step.id));
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("gives every step a way to tell it actually worked", () => {
    // A setup step with no verification is how a student spends an hour stuck
    // on something that silently failed in step two.
    for (const stage of TRACK) {
      for (const step of stage.steps) {
        expect(step.verify.trim().length, `${step.id} needs a verify`).toBeGreaterThan(10);
        expect(step.why.trim().length, `${step.id} needs a why`).toBeGreaterThan(20);
      }
    }
  });

  it("uses https for every link and never a bare http one", () => {
    for (const link of allLinks()) {
      expect(link.href.startsWith("https://"), `${link.href} must be https`).toBe(true);
    }
  });

  it("does not contain the WPILib PathPlanner docs URL that 404s", () => {
    // This one looks entirely plausible and was rejected during link
    // verification. Pinning it so it cannot be re-added from memory.
    const dead = "docs.wpilib.org/en/stable/docs/software/pathplanning/pathplanner/index.html";
    expect(allLinks().some((l) => l.href.includes(dead))).toBe(false);
  });

  it("gives each platform a real, non-empty track", () => {
    for (const os of ["mac", "windows"] as const) {
      const ids = allStepIds(os);
      expect(ids.length).toBeGreaterThan(8);
      expect(totalMinutes(os)).toBeGreaterThan(60);
    }
  });

  it("routes the platform-only steps to the right platform", () => {
    const macIds = allStepIds("mac");
    const winIds = allStepIds("windows");
    // Homebrew is macOS-only; the FRC Game Tools are Windows-only. Showing
    // either to the wrong platform sends a student down a dead end.
    expect(macIds).toContain("homebrew");
    expect(macIds).not.toContain("game-tools");
    expect(winIds).toContain("game-tools");
    expect(winIds).not.toContain("homebrew");
  });

  it("keeps shared steps on both platforms", () => {
    for (const shared of ["git", "vscode", "wpilib", "git-model", "first-pr"]) {
      expect(allStepIds("mac")).toContain(shared);
      expect(allStepIds("windows")).toContain(shared);
    }
  });

  it("only offers commands for a platform that step supports", () => {
    for (const stage of TRACK) {
      for (const step of stage.steps) {
        if (!step.commands) continue;
        if (step.commands.mac && step.os !== "all") {
          expect(step.os, `${step.id} has mac commands`).toContain("mac");
        }
        if (step.commands.windows && step.os !== "all") {
          expect(step.os, `${step.id} has windows commands`).toContain("windows");
        }
      }
    }
  });

  it("orders stages so setup precedes the first contribution", () => {
    const order = TRACK.map((s) => s.id);
    expect(order.indexOf("laptop")).toBeLessThan(order.indexOf("frc"));
    expect(order.indexOf("git")).toBeLessThan(order.indexOf("first-change"));
    expect(order[order.length - 1]).toBe("first-change");
  });

  it("filters a stage's steps by platform", () => {
    const laptop = TRACK.find((s) => s.id === "laptop");
    expect(laptop).toBeDefined();
    expect(stepsForOs(laptop!, "windows").map((s) => s.id)).not.toContain("homebrew");
    expect(stepsForOs(laptop!, "mac").map((s) => s.id)).toContain("homebrew");
  });
});
