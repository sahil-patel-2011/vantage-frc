import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { honestCheckpointId } from "./cad-checkpoint-note";

const source = readFileSync(join(__dirname, "cad-checkpoint-note.tsx"), "utf8");

describe("CadCheckpointNote", () => {
  it("explains stored topology checkpoints and that rollback is not a native Onshape action", () => {
    expect(source).toContain("topology checkpoint after each native execute");
    expect(source).toContain("Rollback is not available as a native Onshape action");
    expect(source).toContain("no FeatureScript fallback");
  });

  it("never mentions FeatureScript as a workaround", () => {
    expect(source).toContain("no FeatureScript fallback");
    expect(source).not.toMatch(/FeatureScript (workaround|rollback|to (?:undo|revert|roll))/i);
    expect(source).not.toMatch(/workaround.{0,60}FeatureScript/i);
    expect(source).not.toMatch(/via FeatureScript/i);
    expect(source).not.toMatch(/use FeatureScript/i);
  });

  it("never invents DEMO checkpoints", () => {
    expect(source).not.toMatch(/\bDEMO[-_]/);
    expect(source).not.toMatch(/demo[-_]?checkpoint|checkpoint[-_]?demo/i);
    expect(source).toContain("none are invented");
    expect(honestCheckpointId("DEMO-checkpoint-1")).toBeNull();
    expect(honestCheckpointId("mock-checkpoint")).toBeNull();
    expect(honestCheckpointId("fake-id")).toBeNull();
    expect(honestCheckpointId("placeholder")).toBeNull();
    expect(honestCheckpointId("")).toBeNull();
    expect(honestCheckpointId(null)).toBeNull();
    expect(honestCheckpointId(undefined)).toBeNull();
  });
});
