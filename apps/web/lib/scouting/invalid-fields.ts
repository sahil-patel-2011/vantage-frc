/**
 * Which questions a list of save problems is about.
 *
 * validatePayload (@vantage/scouting) words every problem as "<label> <what is wrong>". The
 * screens used to match a problem to a question with `issue.startsWith(field.label)`, so a
 * problem with "Auto notes" also lit up a question called "Auto". Here a problem belongs to the
 * one question with the longest label it starts with, followed by a space.
 */

type LabelledField = { key: string; label: string };

/** The question a single problem is about, or null for a problem about the whole report. */
export function fieldForIssue<T extends LabelledField>(fields: readonly T[], issue: string): T | null {
  let best: T | null = null;
  for (const field of fields) {
    const label = field.label.trim();
    if (!label || !issue.startsWith(`${label} `)) continue;
    if (!best || label.length > best.label.trim().length) best = field;
  }
  return best;
}

/** Keys of every question with a problem. */
export function invalidFieldKeys(fields: readonly LabelledField[], issues: readonly string[]): Set<string> {
  const keys = new Set<string>();
  for (const issue of issues) {
    const field = fieldForIssue(fields, issue);
    if (field) keys.add(field.key);
  }
  return keys;
}

/** The first question, in form order, that has a problem. */
export function firstInvalidField<T extends LabelledField>(fields: readonly T[], issues: readonly string[]): T | null {
  const keys = invalidFieldKeys(fields, issues);
  return fields.find((field) => keys.has(field.key)) ?? null;
}

/** The problem shown under one question. */
export function issueForField(fields: readonly LabelledField[], field: LabelledField, issues: readonly string[]): string | undefined {
  return issues.find((issue) => fieldForIssue(fields, issue)?.key === field.key);
}
