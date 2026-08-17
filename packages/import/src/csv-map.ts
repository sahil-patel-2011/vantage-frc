export type ColumnGuess =
  | "event_key"
  | "match_key"
  | "team_key"
  | "hours"
  | "person"
  | "date"
  | "ignore";

const ALIASES: Record<ColumnGuess, string[]> = {
  event_key: ["eventkey", "event", "eventcode", "competition"],
  match_key: ["matchkey", "match", "matchnumber", "matchnum"],
  team_key: ["teamkey", "team", "teamnumber", "teamnum", "robot"],
  hours: ["hours", "duration", "timehours", "loggedhours"],
  person: ["name", "student", "member", "person", "email"],
  date: ["date", "day", "loggedon", "checkin"],
  ignore: [],
};

function normalizeHeader(header: string): string {
  return header.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function guessColumn(header: string): ColumnGuess {
  const key = normalizeHeader(header);
  for (const [guess, aliases] of Object.entries(ALIASES) as Array<[ColumnGuess, string[]]>) {
    if (guess === "ignore") continue;
    if (aliases.includes(key)) return guess;
  }
  return "ignore";
}

export function suggestColumnMap(headers: string[]): Record<string, ColumnGuess> {
  return Object.fromEntries(headers.map((header) => [header, guessColumn(header)]));
}

export function parseCsvHeaders(content: string): string[] {
  const first = content.replace(/^\uFEFF/, "").split(/\r?\n/).find((line) => line.trim());
  if (!first) return [];
  return first.split(",").map((cell) => cell.replace(/^"|"$/g, "").trim()).filter(Boolean);
}
