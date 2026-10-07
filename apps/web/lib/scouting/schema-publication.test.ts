import { describe, expect, it } from "vitest";
import { matchSchemaForYear, pitSchemaForYear } from "@vantage/scouting";
import { schemaPublicationRequest } from "./schema-publication";

const request = { orgId: "22222222-2222-4222-8222-222222222222", year: 2026, type: "match",
  definition: { title: "Our form", fields: [{ key: "cycles", label: "Cycles", type: "counter", config: { phase: "teleop" } }] } };

describe("scouting schema publication boundary", () => {
  it.each([matchSchemaForYear(2026), pitSchemaForYear(2026)])("accepts the actual season starter and preserves its metadata", definition => {
    const parsed = schemaPublicationRequest.parse({ ...request, definition });
    expect("definition" in parsed ? parsed.definition : undefined).toEqual(definition);
  });
  it.each([null, {}, { title: "Missing questions" }, { title: "Broken", fields: [null] },
    { title: "Broken", fields: [{ key: "x", label: "X", type: "unsupported" }] },
    { title: "Broken", fields: [{ key: "x", label: "X", type: "counter" }, { key: "x", label: "Y", type: "text" }] },
    { title: "Broken", fields: [{ key: "__proto__", label: "X", type: "text" }] },
    { title: "Broken", fields: [{ key: "x", label: "X", type: "dropdown" }] },
    { title: "Broken", fields: [{ key: "x", label: "X", type: "multi_select", options: ["yes", "yes"] }] },
    { title: "Broken", fields: [{ key: "x", label: "X", type: "select", options: [" "] }] },
  ])("rejects a malformed or ambiguous definition before persistence: %j", definition => {
    expect(schemaPublicationRequest.safeParse({ ...request, definition }).success).toBe(false);
  });
  it("rejects invalid years/types and preserves valid custom presentation settings", () => {
    expect(schemaPublicationRequest.safeParse({ ...request, year: 2026.5 }).success).toBe(false);
    expect(schemaPublicationRequest.safeParse({ ...request, type: "other" }).success).toBe(false);
    expect(schemaPublicationRequest.parse(request)).toEqual(request);
    expect(schemaPublicationRequest.parse({ orgId: request.orgId, action: "ensure_defaults" })).toEqual({ orgId: request.orgId, action: "ensure_defaults" });
  });
  it("rejects broken conditional questions, missing controllers and self references", () => {
    for (const rule of [{ anyOf: [null] }, { fieldKey: "missing", isTrue: true }, { fieldKey: "cycles", isSet: true }]) {
      const definition = { ...request.definition, fields: [{ ...request.definition.fields[0]!, config: { visibleWhen: rule } }] };
      expect(schemaPublicationRequest.safeParse({ ...request, definition }).success).toBe(false);
    }
    const definition = { title: "Conditional", fields: [
      { key: "attempted", label: "Attempted", type: "boolean" },
      { key: "seconds", label: "Seconds", type: "number", config: { visibleWhen: { fieldKey: "attempted", isTrue: true } } },
    ] };
    expect(schemaPublicationRequest.safeParse({ ...request, definition }).success).toBe(true);
    expect(schemaPublicationRequest.safeParse({ ...request, definition: { title: "Cycle", fields: [
      { key: "a", label: "A", type: "boolean", visibleWhen: { fieldKey: "b", isTrue: true } },
      { key: "b", label: "B", type: "boolean", visibleWhen: { fieldKey: "a", isTrue: true } },
    ] } }).success).toBe(false);
  });
});
