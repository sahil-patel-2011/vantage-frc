import { describe, expect, it } from "vitest";
import { newDraftQuestion } from "./form-builder";
import { formEditorPrefix, listFormEditorDrafts, parseFormEditorDraft, removeFormEditorDraft, saveFormEditorDraft, type DraftStorage, type FormEditorDraft } from "./form-editor-draft";

function storage(): DraftStorage {
  const entries = new Map<string, string>();
  return { get length() { return entries.size; }, key: index => [...entries.keys()][index] ?? null,
    getItem: key => entries.get(key) ?? null, setItem: (key, value) => { entries.set(key, value); }, removeItem: key => { entries.delete(key); } };
}
const draft: FormEditorDraft = {
  format: 1, userId: "lead", orgId: "team", year: 2026, type: "match", editorId: "11111111-1111-4111-8111-111111111111",
  savedAt: "2026-10-07T12:00:00.000Z", baseSchemaId: null, title: "Unfinished form", acknowledgeBudget: false,
  questions: [newDraftQuestion({ id: "question", label: "", kind: "short" })],
};
describe("unpublished scouting form recovery", () => {
  it("retains explicit official outcome selection in an unfinished private draft", () => {
    const selected = { ...draft, questions: [newDraftQuestion({ key: "q_original", officialComparison: "mobility" })] };
    const store = storage(); saveFormEditorDraft(store, selected);
    expect(listFormEditorDrafts(store, selected)[0]?.questions[0]).toMatchObject({ key: "q_original", officialComparison: "mobility" });
  });
  it("keeps incomplete questions and exact stable keys through reload", () => {
    const store = storage(); saveFormEditorDraft(store, draft);
    expect(listFormEditorDrafts(store, draft)[0]).toMatchObject(draft);
    expect(parseFormEditorDraft(store.getItem(formEditorPrefix(draft) + draft.editorId), { ...draft, userId: "other" })).toBeNull();
    for (const scope of [{ ...draft, orgId: "other" }, { ...draft, year: 2025 }, { ...draft, type: "pit" as const }]) expect(listFormEditorDrafts(store, scope)).toEqual([]);
  });
  it("keeps simultaneous editors separate and refuses to clear a newer revision", () => {
    const store = storage(); saveFormEditorDraft(store, draft);
    const other = { ...draft, editorId: "22222222-2222-4222-8222-222222222222", title: "Other editor", savedAt: "2026-10-07T13:00:00.000Z" };
    saveFormEditorDraft(store, other);
    const newer = { ...draft, title: "Newer work", savedAt: "2026-10-07T14:00:00.000Z" }; saveFormEditorDraft(store, newer);
    removeFormEditorDraft(store, draft);
    expect(listFormEditorDrafts(store, draft).map(item => item.title)).toEqual(["Newer work", "Other editor"]);
    removeFormEditorDraft(store, newer);
    expect(listFormEditorDrafts(store, draft).map(item => item.title)).toEqual(["Other editor"]);
  });
  it("rejects malformed or duplicate questions and propagates blocked/full storage", () => {
    for (const value of [{ ...draft, questions: [null] }, { ...draft, questions: [draft.questions[0], draft.questions[0]] }, { ...draft, questions: [{ ...draft.questions[0], settings: { sliderMin: "bad" } }] }]) expect(parseFormEditorDraft(JSON.stringify(value), draft)).toBeNull();
    const blocked = { ...storage(), setItem: () => { throw new Error("Quota exceeded"); } };
    expect(() => saveFormEditorDraft(blocked, draft)).toThrow("Quota exceeded");
  });
});
