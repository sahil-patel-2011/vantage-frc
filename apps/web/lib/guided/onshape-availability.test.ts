import { describe, expect, it } from "vitest";
import { canAskLeadInsteadOfOnshape, onshapeOffNotice, stepNeedsOnshape } from "./onshape-availability";
import { GUIDED_TRACKS } from "./tracks";
import type { StepCheck } from "./types";

const connect: StepCheck = { kind: "onshape-connected" };
const paste: StepCheck = { kind: "paste", prompt: "Paste the build output", must: [{ pattern: "BUILD SUCCESSFUL", missing: "no success line" }] };

describe("guided steps when Onshape is off for the deployment", () => {
  it("knows which steps only Onshape can check", () => {
    expect(stepNeedsOnshape(connect)).toBe(true);
    expect(stepNeedsOnshape({ kind: "onshape-mass" })).toBe(true);
    expect(stepNeedsOnshape(paste)).toBe(false);
    expect(stepNeedsOnshape({ kind: "lead-signoff", what: "band saw" })).toBe(false);
    expect(stepNeedsOnshape({ kind: "github-tag" })).toBe(false);
  });

  it("every Onshape track step is Onshape-checked, and no Git step is", () => {
    for (const track of GUIDED_TRACKS) {
      for (const step of track.steps) {
        if (track.id.startsWith("git-")) expect(stepNeedsOnshape(step.check), `${track.id}/${step.id}`).toBe(false);
      }
      if (track.id.startsWith("onshape-")) expect(stepNeedsOnshape(track.steps[0]!.check), track.id).toBe(true);
    }
  });

  it("offers a lead sign-off only while Onshape is off, and only for Onshape steps", () => {
    expect(canAskLeadInsteadOfOnshape(connect, false)).toBe(true);
    expect(canAskLeadInsteadOfOnshape(connect, true)).toBe(false);
    expect(canAskLeadInsteadOfOnshape(paste, false)).toBe(false);
  });

  it("never tells the student to press Connect when there is nothing to connect", () => {
    const notice = onshapeOffNotice("onshape-first-part", connect);
    expect(notice.body).toMatch(/isn't switched on/);
    expect(notice.body).not.toMatch(/press Connect/i);
    expect(notice.body).toMatch(/lead/);
    expect(notice.dxf).toBeNull();
  });

  it("points drawing steps at the DXF checker", () => {
    const drawingStep = GUIDED_TRACKS.find((t) => t.id === "onshape-drawing")!.steps.find((s) => s.check.kind !== "onshape-connected")!;
    expect(onshapeOffNotice("onshape-drawing", drawingStep.check).dxf?.href).toBe("/cad-checker");
    expect(onshapeOffNotice("onshape-first-part", { kind: "onshape-mass" }).dxf).toBeNull();
  });
});
