export type KeyShareScope = "personal" | "team" | "selected";
export type KeySharing = { shareScope: KeyShareScope; shareUserIds: string[] };

/** Fail closed; never interpret malformed sharing input as sharing with the whole team. */
export function parseKeySharing(scope: unknown, recipients: unknown): KeySharing {
  if (scope !== "personal" && scope !== "team" && scope !== "selected") throw new Error("Choose personal use, the whole team, or selected people.");
  if (scope !== "selected") return { shareScope: scope, shareUserIds: [] };
  if (!Array.isArray(recipients) || recipients.length === 0 || recipients.length > 100 ||
      recipients.some(id => typeof id !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id))) {
    throw new Error("Choose between 1 and 100 people from this team.");
  }
  return { shareScope: scope, shareUserIds: [...new Set(recipients.map(id => (id as string).toLowerCase()))] };
}
