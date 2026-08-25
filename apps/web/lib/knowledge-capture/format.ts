// Shared markdown assembly for capture-from-work drafts.
//
// HONESTY RULE, enforced here so all three drafters inherit it: a rendered body contains
// nothing but (a) fixed section headings and (b) text that is already present on the
// source row. A section whose source text is blank is DROPPED — it is never emitted as a
// "-" or "TBD" placeholder, because a filled-in blank reads as a recorded fact.

import { MAX_BODY, MAX_SLUG, MAX_TITLE } from "../knowledge/types";
import { slugifyTitle } from "../knowledge/helpers";

/** Trimmed text, or null when the source recorded nothing usable. */
export function cleanText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export type CaptureFact = { label: string; value: unknown };
export type CaptureSection = { heading: string; text: unknown };

export function captureTitle(value: string): string {
  return value.trim().replace(/\s+/g, " ").slice(0, MAX_TITLE);
}

/**
 * `<prefix>-<first words of the title>-<short source id>`, in the strict slug grammar
 * knowledge_pages enforces. The title is capped before slugifying so the id suffix
 * survives the MAX_SLUG truncation and two similarly-titled sources stay distinct.
 */
export function captureSlug(prefix: string, title: string, sourceId: string): string {
  const shortTitle = slugifyTitle(title).split("-").slice(0, 8).join("-");
  const suffix = slugifyTitle(sourceId.replace(/-/g, "").slice(0, 8));
  return slugifyTitle([prefix, shortTitle, suffix].filter(Boolean).join("-"));
}

/**
 * Fixed headings + source text. Facts and sections with no recorded value are omitted.
 * The provenance footer states, on the page itself, where every line came from.
 */
export function renderCaptureBody(input: {
  title: string;
  facts: CaptureFact[];
  sections: CaptureSection[];
  provenance: string;
}): string {
  const lines: string[] = [`# ${input.title}`, ""];

  const facts = input.facts
    .map((fact) => ({ label: fact.label, value: cleanText(fact.value) }))
    .filter((fact): fact is { label: string; value: string } => fact.value !== null);
  for (const fact of facts) lines.push(`**${fact.label}:** ${fact.value}`);
  if (facts.length > 0) lines.push("");

  for (const section of input.sections) {
    const text = cleanText(section.text);
    if (!text) continue;
    lines.push(`## ${section.heading}`, text, "");
  }

  lines.push("---", input.provenance, "");
  return lines.join("\n").slice(0, MAX_BODY);
}

/**
 * A slug not already used by the org's knowledge_pages. knowledge_pages enforces
 * UNIQUE(org_id, slug), so Approve has to settle the collision before inserting rather
 * than failing the whole transaction on the member's second capture of a similar title.
 */
export function uniqueSlug(desired: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  const base = slugifyTitle(desired);
  if (!used.has(base)) return base;
  for (let n = 2; n < 200; n += 1) {
    const suffix = `-${n}`;
    const trimmed = base.slice(0, MAX_SLUG - suffix.length).replace(/-+$/, "");
    const candidate = `${trimmed}${suffix}`;
    if (!used.has(candidate)) return candidate;
  }
  return `${base.slice(0, MAX_SLUG - 14).replace(/-+$/, "")}-${Date.now().toString(36)}`;
}

/** A bullet list from recorded strings; null when nothing was recorded. */
export function bulletList(values: Array<string | null>): string | null {
  const kept = values.map(cleanText).filter((value): value is string => value !== null);
  if (kept.length === 0) return null;
  return kept.map((value) => `- ${value}`).join("\n");
}
