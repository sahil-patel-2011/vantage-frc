import { describe, expect, it } from "vitest";
import { parsePracticeDraft, samePracticeTarget, type PracticeDraft } from "./practice-draft";

const id = "11111111-1111-4111-8111-111111111111";
const draft: PracticeDraft = { clientId: id, type: "match", team: "6925", label: "Practice 1", year: 2026, payload: { cycles: 0 } };

describe("practice scouting draft integrity", () => {
  it("retains a saved report ID and explicitly observed zero", () => {
    expect(parsePracticeDraft(draft, "22222222-2222-4222-8222-222222222222")).toEqual(draft);
    const { clientId: _clientId, ...legacy } = draft;
    expect(parsePracticeDraft(legacy, id)).toEqual(draft);
  });
  it.each([null, [], { ...draft, payload: [] }, { ...draft, year: 2026.5 }, { ...draft, clientId: "broken" },
    { ...draft, definition: { fields: [null] } }, { ...draft, schemaId: id },
  ])("rejects unreadable recovery data before it can crash a form: %j", value => {
    expect(() => parsePracticeDraft(value, id)).toThrow();
  });
  it.each([{ team: "254" }, { type: "pit" as const }, { year: 2025 }, { label: "Practice 2" }, { schemaId: id },
    { definition: { title: "Different questions", fields: [{ key: "notes", label: "Notes", type: "text" as const }] } },
  ])(
    "treats changed identity or questions as a new report, without transferring answers: %j", patch => {
      expect(samePracticeTarget(draft, { ...draft, ...patch })).toBe(false);
    },
  );
  it("keeps the same target through answer edits and harmless match-label spacing", () => {
    expect(samePracticeTarget(draft, { ...draft, label: " Practice 1 ", payload: { cycles: 5 } })).toBe(true);
  });
});
