import { parseCsvHeaders, suggestColumnMap } from "./csv-map";
import { provenanceNow, type ImportDraft } from "./provenance";

/** Split a CSV line on commas, respecting simple quoted cells. */
export function parseCsvLine(line: string): string[] {
  const values: string[] = [];
  let value = "";
  let quoted = false;
  for (let index = 0; index < line.length; index++) {
    const character = line[index]!;
    if (character === '"') {
      if (quoted && line[index + 1] === '"') {
        value += '"';
        index++;
      } else quoted = !quoted;
    } else if (character === "," && !quoted) {
      values.push(value);
      value = "";
    } else value += character;
  }
  values.push(value);
  return values.map((cell) => cell.trim());
}

export function parseCsvRows(content: string): Record<string, string>[] {
  const lines = content
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .filter((line) => line.trim());
  if (lines.length < 2) return [];
  const headers = parseCsvHeaders(lines[0]!);
  return lines.slice(1).map((line) => {
    const cells = parseCsvLine(line);
    return Object.fromEntries(headers.map((header, index) => [header, cells[index] ?? ""]));
  });
}

/**
 * Lookout / GrizzlyTime-style hours CSV. Rows without a person and a positive
 * hours value are skipped — never invent attendance.
 */
export function hoursDraftsFromCsv(content: string, now: Date = new Date()): ImportDraft[] {
  const headers = parseCsvHeaders(content);
  const map = suggestColumnMap(headers);
  const personCol = Object.entries(map).find(([, guess]) => guess === "person")?.[0];
  const hoursCol = Object.entries(map).find(([, guess]) => guess === "hours")?.[0];
  const dateCol = Object.entries(map).find(([, guess]) => guess === "date")?.[0];
  if (!personCol || !hoursCol) return [];

  const drafts: ImportDraft[] = [];
  for (const row of parseCsvRows(content)) {
    const person = (row[personCol] ?? "").trim();
    const hours = Number(row[hoursCol]);
    if (!person || !Number.isFinite(hours) || hours <= 0) continue;
    const dateRaw = dateCol ? (row[dateCol] ?? "").trim() : "";
    const occurred = dateRaw ? new Date(dateRaw) : null;
    if (dateRaw && (!occurred || Number.isNaN(occurred.getTime()))) continue;
    drafts.push({
      kind: "hours",
      title: person,
      startsAt: occurred ? occurred.toISOString() : undefined,
      payload: {
        hours,
        person,
        occurredOn: occurred ? occurred.toISOString().slice(0, 10) : null,
      },
      provenance: provenanceNow("csv", undefined, now),
    });
  }
  return drafts;
}
