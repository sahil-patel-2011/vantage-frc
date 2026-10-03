/**
 * Which "Next actions" links repeat a link the page already shows.
 *
 * About 160 pages build their own next-actions row, and most build it from the same
 * destinations as their related links or their empty state: Dossier listed Strategy,
 * Scouting and Pick desk under the team field and again as next actions; Alumni's only next
 * action pointed at the form directly beneath it, which its empty state also offered. A
 * handful of modules drop those repeats by hand (`dropRelatedStripDuplicates`); this is the
 * same rule applied once, to what is actually on screen.
 */

/**
 * A destination with the team id and trailing slash taken out, so `/strategy?orgId=a&tab=picks`
 * and `/strategy?tab=picks` are the same place. The hash is kept: `#add` and `#edit` are not.
 */
export function destinationKey(href: string, base: string): string | null {
  let url: URL;
  try {
    url = new URL(href, base);
  } catch {
    return null;
  }
  if (!/^https?:$/.test(url.protocol)) return null;
  url.searchParams.delete("orgId");
  url.searchParams.sort();
  const path = url.pathname.replace(/\/+$/, "") || "/";
  const query = url.searchParams.toString();
  return `${url.origin}${path}${query ? `?${query}` : ""}${url.hash}`;
}

/**
 * For each next action, in order: is it a repeat? Either the page shows a link to the same
 * place elsewhere (`offered`), or an earlier next action already goes there.
 */
export function duplicateNextActions(actions: readonly string[], offered: readonly string[], base: string): boolean[] {
  const seen = new Set(offered.map((href) => destinationKey(href, base)).filter((key): key is string => key !== null));
  return actions.map((href) => {
    const key = destinationKey(href, base);
    if (key === null) return false;
    if (seen.has(key)) return true;
    seen.add(key);
    return false;
  });
}
