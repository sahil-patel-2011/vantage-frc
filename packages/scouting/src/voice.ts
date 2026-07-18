import {
  DEFAULT_DRIVETRAIN_OPTIONS,
  type FieldDefinition,
  type SchemaDefinition,
} from "./index";

/** Normalize spoken/typed labels for field matching (case, punctuation, spaces). */
export function normalizeVoiceLabel(value: string): string {
  return value
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isTextLike(field: FieldDefinition): boolean {
  return (
    field.type === "text" ||
    field.type === "short_answer" ||
    field.type === "long_text"
  );
}

function isSelectLike(field: FieldDefinition): boolean {
  return (
    field.type === "select" ||
    field.type === "dropdown" ||
    field.type === "multiple_choice" ||
    field.type === "drivetrain_type"
  );
}

function firstTextField(schema: SchemaDefinition): FieldDefinition | undefined {
  return schema.fields.find((field) => isTextLike(field));
}

function selectOptions(field: FieldDefinition): string[] {
  if (field.type === "drivetrain_type") {
    return field.options?.length ? field.options : [...DEFAULT_DRIVETRAIN_OPTIONS];
  }
  return field.options ?? [];
}

function matchSelectOption(options: string[], text: string): string | undefined {
  const normalized = normalizeVoiceLabel(text);
  const exact = options.find((option) => normalizeVoiceLabel(option) === normalized);
  if (exact) return exact;
  return options.find(
    (option) =>
      normalized.includes(normalizeVoiceLabel(option)) ||
      normalizeVoiceLabel(option).includes(normalized),
  );
}

/** Coerce a raw transcript fragment into a schema field value, or undefined if it cannot apply. */
export function coerceVoiceFieldValue(
  field: FieldDefinition,
  raw: string,
): unknown | undefined {
  const text = raw.trim();
  if (!text) return undefined;

  if (isTextLike(field)) return text;

  if (field.type === "robot_image") {
    // Images are media uploads — voice cannot invent a storage key.
    return undefined;
  }

  if (field.type === "number") {
    const match = text.replace(/,/g, "").match(/-?\d+(?:\.\d+)?/);
    if (!match) return undefined;
    const value = Number(match[0]);
    return Number.isFinite(value) ? value : undefined;
  }

  if (field.type === "boolean") {
    const normalized = normalizeVoiceLabel(text);
    if (["yes", "true", "y", "on", "enabled", "checked"].includes(normalized)) return true;
    if (["no", "false", "n", "off", "disabled", "unchecked"].includes(normalized)) return false;
    return undefined;
  }

  if (isSelectLike(field)) {
    const options = selectOptions(field);
    const matched = matchSelectOption(options, text);
    if (!matched) return undefined;
    if (field.type === "multiple_choice" && field.config?.allowMultiple) {
      return [matched];
    }
    return matched;
  }

  return undefined;
}

type ApplyResult = {
  payload: Record<string, unknown>;
  appliedFieldKeys: string[];
  unmatched: string;
};

function fieldAliases(field: FieldDefinition): string[] {
  return [field.key, field.label]
    .map(normalizeVoiceLabel)
    .filter(Boolean)
    .sort((a, b) => b.length - a.length);
}

/**
 * Apply a voice transcript onto a custom form payload.
 * - With `fieldKey`: coerce the whole transcript into that field.
 * - Without: parse "Label value" / "key: value" segments, then dump leftover into the first text field.
 */
export function applyVoiceTranscriptToForm(
  schema: SchemaDefinition,
  payload: Record<string, unknown>,
  transcript: string,
  options?: { fieldKey?: string | null },
): ApplyResult {
  const next = { ...payload };
  const appliedFieldKeys: string[] = [];
  const trimmed = transcript.trim();
  if (!trimmed) return { payload: next, appliedFieldKeys, unmatched: "" };

  const targetKey = options?.fieldKey?.trim() || null;
  if (targetKey) {
    const field = schema.fields.find((candidate) => candidate.key === targetKey);
    if (!field) return { payload: next, appliedFieldKeys, unmatched: trimmed };
    const value = coerceVoiceFieldValue(field, trimmed);
    if (value === undefined) return { payload: next, appliedFieldKeys, unmatched: trimmed };
    next[field.key] = value;
    return { payload: next, appliedFieldKeys: [field.key], unmatched: "" };
  }

  const aliases = schema.fields
    .filter((field) => field.type !== "robot_image")
    .flatMap((field) => fieldAliases(field).map((alias) => ({ alias, field })));
  aliases.sort((a, b) => b.alias.length - a.alias.length);

  let remaining = trimmed;
  for (const { alias, field } of aliases) {
    if (!alias) continue;
    const pattern = new RegExp(
      `(?:^|[\\s,;]+)(?:${alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})\\s*[:=\\-]?\\s*`,
      "i",
    );
    const match = remaining.match(pattern);
    if (!match || match.index == null) continue;
    const start = match.index + match[0].length;
    const after = remaining.slice(start);
    const nextAlias = aliases
      .map(({ alias: other }) => {
        const otherPattern = new RegExp(
          `(?:^|[\\s,;]+)(?:${other.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})\\s*[:=\\-]?\\s*`,
          "i",
        );
        const found = after.match(otherPattern);
        return found?.index != null ? found.index : Number.POSITIVE_INFINITY;
      })
      .reduce((min, index) => Math.min(min, index), Number.POSITIVE_INFINITY);
    const rawValue = after.slice(0, Number.isFinite(nextAlias) ? nextAlias : undefined).trim();
    const value = coerceVoiceFieldValue(field, rawValue);
    if (value === undefined) continue;
    next[field.key] = value;
    if (!appliedFieldKeys.includes(field.key)) appliedFieldKeys.push(field.key);
    const removeFrom = match.index;
    const removeTo = start + rawValue.length;
    remaining = `${remaining.slice(0, removeFrom)} ${remaining.slice(removeTo)}`.replace(/\s+/g, " ").trim();
  }

  if (remaining) {
    const notes = firstTextField(schema);
    if (notes && !appliedFieldKeys.includes(notes.key)) {
      const existing = typeof next[notes.key] === "string" ? String(next[notes.key]).trim() : "";
      next[notes.key] = existing ? `${existing} ${remaining}`.trim() : remaining;
      appliedFieldKeys.push(notes.key);
      remaining = "";
    }
  }

  return { payload: next, appliedFieldKeys, unmatched: remaining };
}

export interface VoiceDraftAdapter {
  transcript(blob: Blob): Promise<string>;
}

/**
 * Browser STT usually yields text before/with the audio blob. Remember that pairing so
 * offline outbox sync can upload audio + transcript together without a server STT call.
 */
export class BrowserVoiceDraftAdapter implements VoiceDraftAdapter {
  private readonly transcripts = new WeakMap<Blob, string>();

  remember(blob: Blob, transcript: string): void {
    this.transcripts.set(blob, transcript.trim());
  }

  async transcript(blob: Blob): Promise<string> {
    const remembered = this.transcripts.get(blob);
    if (remembered != null && remembered.length > 0) return remembered;
    throw new Error("Browser speech recognition must provide the transcript");
  }
}
