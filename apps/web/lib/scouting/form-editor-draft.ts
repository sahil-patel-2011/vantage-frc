import { z } from "zod";
import { OFFICIAL_COMPARISON_MODES } from "@vantage/scouting/official-fields";
import { isVisibleWhen, type VisibleWhen } from "@vantage/scouting/visibility";
import { ANSWER_KIND_OPTIONS, STRATEGY_ROLE_OPTIONS, type DraftQuestion } from "./form-builder";

export type FormEditorScope = { userId: string; orgId: string; year: number; type: "match" | "pit" };
const text = z.string().max(20_000);
const question = z.object({
  id: z.string().min(1).max(200), key: z.string().max(200).optional(), label: text,
  kind: z.custom<DraftQuestion["kind"]>(value => ANSWER_KIND_OPTIONS.some(option => option.kind === value) || value === "robot_image"),
  required: z.boolean(), optionsText: text,
  role: z.custom<DraftQuestion["role"]>(value => STRATEGY_ROLE_OPTIONS.some(option => option.role === value)),
  reset: z.enum(["reset", "preserve", "increment"]),
  settings: z.object({
    counterStepsText: text.optional(), allowNegative: z.boolean().optional(), maxText: text.optional(),
    subCountersText: text.optional(), timerMode: z.enum(["lap", "total"]).optional(), ratingMax: z.number().finite().optional(),
    sliderMin: z.number().finite().optional(), sliderMax: z.number().finite().optional(), sliderStep: z.number().finite().optional(),
    sliderMinLabel: text.optional(), sliderMaxLabel: text.optional(), gridCols: z.number().finite().optional(), gridRows: z.number().finite().optional(),
  }),
  chart: z.enum(["auto", "bar", "trend", "none"]).optional(), helpText: text.optional(),
  collectionConfig: z.record(z.string(), z.unknown()).optional(),
  officialComparison: z.enum(OFFICIAL_COMPARISON_MODES).optional(),
  visibleWhen: z.custom<VisibleWhen>(isVisibleWhen).nullable().optional(),
});
const record = z.object({
  format: z.literal(1), userId: z.string().min(1), orgId: z.string().min(1), year: z.number().int().min(1992).max(2100),
  type: z.enum(["match", "pit"]), editorId: z.string().uuid(), savedAt: z.string().datetime(),
  baseSchemaId: z.string().nullable(), title: z.string().max(200), questions: z.array(question).max(200), acknowledgeBudget: z.boolean(),
});
export type FormEditorDraft = z.infer<typeof record>;
export type DraftStorage = Pick<Storage, "length" | "key" | "getItem" | "setItem" | "removeItem">;
const MAX_CHARS = 262_144;
export function formEditorPrefix(scope: FormEditorScope): string {
  return `vantage:form-editor:v1:${[scope.userId, scope.orgId, scope.year, scope.type].map(value => encodeURIComponent(String(value))).join(":")}:`;
}
export function parseFormEditorDraft(raw: string | null, scope: FormEditorScope): FormEditorDraft | null {
  if (!raw || raw.length > MAX_CHARS) return null;
  try {
    const parsed = record.safeParse(JSON.parse(raw));
    if (!parsed.success) return null;
    const value = parsed.data;
    if (value.userId !== scope.userId || value.orgId !== scope.orgId || value.year !== scope.year || value.type !== scope.type) return null;
    if (new Set(value.questions.map(item => item.id)).size !== value.questions.length) return null;
    return value;
  } catch { return null; }
}
/** Each open editor writes its own record; two tabs never share a write key. */
export function listFormEditorDrafts(storage: DraftStorage, scope: FormEditorScope): FormEditorDraft[] {
  const prefix = formEditorPrefix(scope);
  const drafts: FormEditorDraft[] = [];
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i);
    if (!key?.startsWith(prefix)) continue;
    const draft = parseFormEditorDraft(storage.getItem(key), scope);
    if (draft && key === prefix + draft.editorId) drafts.push(draft);
  }
  return drafts.sort((a, b) => b.savedAt.localeCompare(a.savedAt));
}
export function saveFormEditorDraft(storage: DraftStorage, draft: FormEditorDraft): void {
  const raw = JSON.stringify(draft);
  if (raw.length > MAX_CHARS || !parseFormEditorDraft(raw, draft)) throw new Error("Draft cannot be saved on this device.");
  storage.setItem(formEditorPrefix(draft) + draft.editorId, raw);
}
/** Never clear another tab's newer revision after an older publication returns. */
export function removeFormEditorDraft(storage: DraftStorage, draft: FormEditorDraft): void {
  const key = formEditorPrefix(draft) + draft.editorId;
  const current = parseFormEditorDraft(storage.getItem(key), draft);
  if (current && JSON.stringify(current) === JSON.stringify(record.parse(draft))) storage.removeItem(key);
}
