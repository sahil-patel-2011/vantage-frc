import { describe, expect, it } from "vitest";
import { fieldsForMatchStage, matchFieldStages } from "./match-form-flow";
import type { FieldDefinition } from "@vantage/scouting";
const fields: FieldDefinition[] = [
  { key: "start", label: "Starting position", type: "field_position" },
  { key: "autoHeader", label: "Autonomous", type: "section_header" },
  { key: "fuel", label: "Fuel scored", type: "counter", required: true },
  { key: "teleop", label: "Teleop", type: "section_header" },
  { key: "cycles", label: "Cycles", type: "counter" },
  { key: "climb", label: "Climb", type: "boolean" },
  { key: "notes", label: "Notes", type: "text" },
];
describe("match form flow", () => {
  it("keeps only phase actions while carrying section context", () => {
    expect(fieldsForMatchStage(fields, "auto").map(field => field.key)).toEqual(["autoHeader", "fuel"]);
    expect(fieldsForMatchStage(fields, "teleop").map(field => field.key)).toEqual(["teleop", "cycles"]);
    expect(fieldsForMatchStage(fields, "endgame").map(field => field.key)).toEqual(["climb"]);
    expect(fieldsForMatchStage(fields, "pre").map(field => field.key)).toEqual(["start"]);
  });
  it("always includes every conditional-visible field in review, including required ones", () => {
    expect(fieldsForMatchStage(fields, "review")).toEqual(fields);
    expect(fieldsForMatchStage(fields, "all")).toEqual(fields);
  });
  it("doesn't strand custom fields or guess which phase an unfamiliar action belongs to", () => {
    const custom: FieldDefinition[] = [{key: "x", label: "Custom action", type: "counter"}];
    expect(fieldsForMatchStage(custom, "auto")).toEqual(custom);
    expect(fieldsForMatchStage(custom, "endgame")).toEqual(custom);
  });
  it("honors explicit form phases over labels and recognizes snake and camel case", () => {
    const custom: FieldDefinition[] = [{key:"auto_cycles",label:"Cycles",type:"counter"},{key:"teleopCycles",label:"Cycles",type:"counter"},{key:"autoTest",label:"Auto test",type:"counter",config:{scoutPhase:"review"}}];
    expect([...matchFieldStages(custom).values()]).toEqual(["auto", "teleop", "review"]);
  });
});
