/**
 * The OPTIONAL AI layer for Get-unstuck.
 *
 * Scope is deliberately tiny: given the student's free text, pick an entry node
 * that already exists in the curated tree and re-phrase that node's first check
 * in the student's own words. It may not produce a fix, a step, or a doc link —
 * those come from apps/web/lib/troubleshoot/symptom-tree.ts and nowhere else.
 *
 * Everything here is pure so the contract can be tested without a model:
 * the prompt is built from the tree, and the parser REJECTS any symptom id that
 * is not in the tree. A rejected response falls back to `matchSymptoms`, which
 * is why the page works identically with no AI provider configured.
 */
import { SYMPTOMS, symptomById } from "./symptom-tree";

export type TriageSuggestion = {
  symptomId: string;
  /** The tree's own first check, re-worded for this student. Never a new instruction. */
  restatedCheck: string;
  /** One line on why this symptom was chosen. Shown next to the tree path. */
  rationale: string;
};

const MAX_DESCRIPTION_CHARS = 1200;
const MAX_RESTATEMENT_CHARS = 320;
const MAX_RATIONALE_CHARS = 240;

export function clampDescription(text: string): string {
  return text.replace(/\s+/g, " ").trim().slice(0, MAX_DESCRIPTION_CHARS);
}

/**
 * The model sees the catalog and the entry check of each symptom — never the
 * fixes. It cannot leak a fix it was not shown.
 */
export function buildTriagePrompt(description: string): string {
  const catalog = SYMPTOMS.map((symptom) => {
    const entry = symptom.checks.find((check) => check.id === symptom.entryCheckId);
    return [
      `- id: ${symptom.id}`,
      `  label: ${symptom.label}`,
      `  covers: ${symptom.summary}`,
      `  first check: ${entry?.action ?? ""}`,
    ].join("\n");
  }).join("\n");

  return [
    "You are triaging an FRC control-system problem for a student.",
    "",
    "You must choose exactly one symptom id from this fixed catalog. You may not invent an id,",
    "and you may not suggest a fix, a command, a setting, or a documentation link — a curated",
    "decision tree owns all of that. Your only job is to pick the entry point and restate that",
    "symptom's FIRST CHECK in the student's own words so it feels like their problem.",
    "",
    "Catalog:",
    catalog,
    "",
    `Student's description: """${clampDescription(description)}"""`,
    "",
    "Reply with JSON only, no prose, no code fence:",
    '{"symptomId":"<id from the catalog>","restatedCheck":"<the first check, reworded, one sentence>","rationale":"<one short sentence on why this symptom>"}',
    "",
    "If nothing in the catalog fits, reply exactly: {\"symptomId\":null}",
  ].join("\n");
}

function extractJsonObject(raw: string): unknown {
  const trimmed = raw.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  try {
    return JSON.parse(trimmed.slice(start, end + 1)) as unknown;
  } catch {
    return null;
  }
}

function cleanLine(value: unknown, max: number): string {
  if (typeof value !== "string") return "";
  return value.replace(/\s+/g, " ").trim().slice(0, max);
}

/**
 * Strict parse. Returns null — meaning "fall back to the offline matcher" —
 * for anything that is not a symptom id the tree actually contains.
 */
export function parseTriageResponse(raw: string): TriageSuggestion | null {
  const parsed = extractJsonObject(raw);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;

  const record = parsed as Record<string, unknown>;
  const symptomId = typeof record.symptomId === "string" ? record.symptomId.trim() : "";
  const symptom = symptomById(symptomId);
  if (!symptom) return null;

  const entry = symptom.checks.find((check) => check.id === symptom.entryCheckId);
  const restated = cleanLine(record.restatedCheck, MAX_RESTATEMENT_CHARS);
  const rationale = cleanLine(record.rationale, MAX_RATIONALE_CHARS);

  return {
    symptomId: symptom.id,
    // If the model gave nothing usable we show the tree's own wording rather than a blank.
    restatedCheck: restated || entry?.action || symptom.summary,
    rationale: rationale || `Matched the "${symptom.label}" walk.`,
  };
}
