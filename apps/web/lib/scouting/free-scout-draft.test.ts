import { describe, expect, it } from "vitest";
import { freshFreeScoutDraft, parseFreeScoutDraft } from "./free-scout-draft";

describe("practice draft recovery", () => {
  const draft = {
    ...freshFreeScoutDraft("match"), team: "6925", year: 2026,
    reportId: "11111111-1111-4111-8111-111111111111", observedAt: "2026-10-09T12:00:00.000Z",
    definition: { title: "Original form", fields: [{ key: "notes", label: "Notes", type: "text" }] },
    payload: { notes: "Observed drive issue" },
  };
  it("preserves the submission identity and original question document through reloads", () => {
    expect(parseFreeScoutDraft(JSON.stringify(draft))).toEqual(draft);
  });
  it("still accepts drafts saved before submission identities were introduced", () => {
    const { reportId, observedAt, ...legacy } = draft;
    expect(parseFreeScoutDraft(JSON.stringify(legacy))).toEqual(legacy);
  });
  it.each([{ definition: { fields: null } }, { observedAt: "invalid" }, { reportId: "bad-id" }, { payload: [] }, { year: 0 }])("rejects unusable recovery data without starting a broken form: %j", patch => {
    expect(() => parseFreeScoutDraft(JSON.stringify({ ...draft, ...patch }))).toThrow();
  });
});
