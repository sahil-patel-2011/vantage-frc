import { hubHref } from "../nav/hubs";

/** Soft-UI related Build surfaces + Competition / AI cross-hub links. */
export const BUILD_RELATED_LINKS = [
  { id: "kickoff", label: "Kickoff", tab: "kickoff" },
  { id: "cad", label: "CAD", tab: "cad" },
  { id: "code", label: "Code", tab: "code" },
  { id: "fmea", label: "Robot", tab: "fmea" },
  { id: "prototype", label: "Prototypes", tab: "prototype" },
  { id: "batteries", label: "Batteries", tab: "batteries" },
  { id: "competition", label: "Competition", href: "/competition" },
  { id: "ai", label: "AI", href: "/ai" },
] as const;

export type BuildRelatedId = (typeof BUILD_RELATED_LINKS)[number]["id"];

export type BuildRelatedLink = {
  id: BuildRelatedId;
  label: string;
  href: string;
};

function withOrg(path: string, orgId?: string | null): string {
  if (!orgId) return path;
  const join = path.includes("?") ? "&" : "?";
  return `${path}${join}orgId=${encodeURIComponent(orgId)}`;
}

/** Cross-links between Build Soft-UI surfaces (never DEMO placeholders). */
export function buildRelatedLinks(
  orgId?: string | null,
  options?: { active?: BuildRelatedId; include?: BuildRelatedId[] },
): BuildRelatedLink[] {
  const include = options?.include ? new Set(options.include) : null;
  return BUILD_RELATED_LINKS.filter((link) => {
    if (link.id === options?.active) return false;
    if (include && !include.has(link.id)) return false;
    return true;
  }).map((link) => {
    if ("tab" in link && link.tab) {
      return { id: link.id, label: link.label, href: hubHref("/build", link.tab, orgId) };
    }
    return {
      id: link.id,
      label: link.label,
      href: withOrg(link.href, orgId),
    };
  });
}
