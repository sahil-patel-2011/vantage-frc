import { describe, expect, it } from "vitest";
import {
  currentStep,
  partIdFromScan,
  partStepsPath,
  sortForKiosk,
  stateAfterAllStepsDone,
  stateAfterStepReopened,
  stateAfterStepStart,
  stepProgress,
  stepTemplate,
  type ShopPart,
  type ShopStep,
} from "./steps-model";
import { isAllowedTransition } from ".";

const PART = "6f1c2b9e-4a7d-4c1e-9b2a-0d3e5f7a9c11";
const ORG = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

const step = (id: string, status: ShopStep["status"], position: number): ShopStep => ({
  id,
  partId: PART,
  position,
  title: id,
  machine: null,
  notes: null,
  status,
  workedBy: null,
  workedByName: null,
  startedAt: null,
  doneAt: null,
});

describe("shop steps model", () => {
  it("the next step is the one in progress, else the first not done", () => {
    expect(currentStep([step("a", "done", 0), step("b", "todo", 1), step("c", "doing", 2)])?.id).toBe("c");
    expect(currentStep([step("a", "done", 0), step("b", "todo", 1), step("c", "todo", 2)])?.id).toBe("b");
    expect(currentStep([step("a", "done", 0)])).toBeNull();
    expect(stepProgress([step("a", "done", 0), step("b", "todo", 1)])).toEqual({ done: 1, total: 2 });
  });

  it("reads a part from a drawing QR address, a bare id, or nothing else", () => {
    expect(partIdFromScan(`https://vantagefrc.vercel.app${partStepsPath(ORG, PART)}`)).toBe(PART);
    expect(partIdFromScan(`  ${PART.toUpperCase()}\n`)).toBe(PART);
    expect(partIdFromScan("hello")).toBeNull();
    expect(partIdFromScan(`javascript:alert(1)//${PART}`)).toBeNull();
    expect(partStepsPath(ORG, PART)).toBe(`/manufacturing/part/${PART}?orgId=${ORG}`);
  });

  it("only ever asks for board moves the board's own state machine allows", () => {
    for (const state of ["needs_design", "needs_cam", "ready_to_cut", "in_progress", "needs_finishing", "done", "scrapped"] as const) {
      for (const next of [stateAfterStepStart(state), stateAfterAllStepsDone(state), stateAfterStepReopened(state)]) {
        if (next) expect(isAllowedTransition(state, next)).toBe(true);
      }
    }
    expect(stateAfterStepStart("ready_to_cut")).toBe("in_progress");
    expect(stateAfterStepStart("needs_design")).toBeNull();
    expect(stateAfterAllStepsDone("in_progress")).toBe("done");
    expect(stateAfterAllStepsDone("scrapped")).toBeNull();
    expect(stateAfterStepReopened("done")).toBe("needs_finishing");
  });

  it("has starter steps for machined parts and none for bought ones", () => {
    expect(stepTemplate("mill").length).toBeGreaterThan(2);
    expect(stepTemplate("cots")).toEqual([]);
  });

  it("puts parts on a machine first on the kiosk, then by needed-by", () => {
    const part = (id: string, state: ShopPart["state"], neededBy: string | null): ShopPart => ({
      id, partName: id, quantity: 1, method: "mill", state, material: null, neededBy, subsystemName: null, drawingUrl: null, steps: [],
    });
    const sorted = sortForKiosk([part("q-late", "ready_to_cut", "2026-11-02"), part("q-soon", "ready_to_cut", "2026-10-20"), part("on", "in_progress", null)]);
    expect(sorted.map((row) => row.id)).toEqual(["on", "q-soon", "q-late"]);
  });
});
