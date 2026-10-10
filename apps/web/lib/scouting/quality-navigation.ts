export type QualityQuery = Record<string, string | string[] | undefined>;

/** One quality workspace, preserving team, event and report deep-link context. */
export function scoutingQualityHref(query: QualityQuery = {}, section?: "scouts" | "checks") {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (key === "tab" || key === "scoutTab") continue;
    for (const item of Array.isArray(value) ? value : value === undefined ? [] : [value]) params.append(key, item);
  }
  if (section) params.set("section", section);
  return `/scouting/quality${params.size ? `?${params}` : ""}`;
}
