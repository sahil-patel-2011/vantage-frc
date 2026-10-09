import { isDashboardWidgetType } from "./catalog";

/** Confirm the actual board result before replacing a member's open layout. */
export function confirmedBoardMutation(value: unknown, expected: {
  id?: string; scope?: "personal" | "org"; layout?: boolean;
} = {}): boolean {
  if (!value || typeof value !== "object") return false;
  const result = value as Record<string, unknown>;
  if (typeof result.id !== "string" || !result.id || typeof result.name !== "string" || !result.name.trim()
    || !["personal", "org"].includes(String(result.scope))) return false;
  if (expected.id && result.id !== expected.id) return false;
  if (expected.scope && result.scope !== expected.scope) return false;
  if (expected.layout === false) return true;
  if (!Array.isArray(result.layout) || result.layout.length > 24) return false;
  const seen = new Set<string>();
  for (const raw of result.layout) {
    if (!raw || typeof raw !== "object") return false;
    const item = raw as Record<string, unknown>;
    if (typeof item.i !== "string" || !item.i || seen.has(item.i) || !isDashboardWidgetType(item.type)) return false;
    if (![item.x, item.y, item.w, item.h].every(n => typeof n === "number" && Number.isFinite(n) && n >= 0)
      || Number(item.w) <= 0 || Number(item.h) <= 0) return false;
    seen.add(item.i);
  }
  return true;
}
