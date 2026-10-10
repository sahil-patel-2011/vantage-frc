/** Preserve a tool's event/report filters while replacing the hub-owned tab and team. */
export function hubLegacyContextHref(destination: string, search: string, orgId: string | null) {
  const url = new URL(destination, "https://vantage.invalid");
  const fixed = new Set(url.searchParams.keys());
  for (const [key, value] of new URLSearchParams(search)) {
    if (key !== "tab" && key !== "orgId" && !fixed.has(key)) url.searchParams.append(key, value);
  }
  if (orgId) url.searchParams.set("orgId", orgId);
  else url.searchParams.delete("orgId");
  return `${url.pathname}${url.search}${url.hash}`;
}
