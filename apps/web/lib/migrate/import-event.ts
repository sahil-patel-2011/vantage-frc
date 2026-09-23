/** How an import form chooses which event the file belongs to. */
export type ImportEventMode = "all" | "active" | "other";

/**
 * QRScout scans need an event, so a saved active event is the default.
 * Optional filters stay open to every event in the file — a season export
 * often spans more than the event the team is working now.
 */
export function initialImportEventMode(input: {
  required: boolean;
  activeKey: string | null | undefined;
}): ImportEventMode {
  const key = input.activeKey?.trim() ?? "";
  if (!key) return "other";
  return input.required ? "active" : "all";
}

/** The event key posted with preview and commit. Empty means do not filter. */
export function resolveImportEventKey(input: {
  mode: ImportEventMode;
  activeKey: string | null | undefined;
  typedKey: string;
}): string {
  switch (input.mode) {
    case "active":
      return input.activeKey?.trim() ?? "";
    case "other":
      return input.typedKey.trim();
    case "all":
      return "";
    default: {
      const _never: never = input.mode;
      return _never;
    }
  }
}
