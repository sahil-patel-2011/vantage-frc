import { hubHref } from "../nav/hubs";

/** Soft-UI next steps from Files — Playbook owns Drive; Chat and CAD consume the bytes. */
export const FILES_RELATED_LINKS = [
  { id: "playbook", label: "Playbook", hub: "/team" as const, tab: "knowledge" },
  { id: "messages", label: "Team chat", hub: "/team" as const, tab: "messages" },
  { id: "cad", label: "CAD", hub: "/build" as const, tab: "cad" },
] as const;

export type FilesRelatedId = (typeof FILES_RELATED_LINKS)[number]["id"];

export type FilesRelatedLink = {
  id: FilesRelatedId;
  label: string;
  href: string;
};

export const FILES_RELATED_INCLUDE: FilesRelatedId[] = ["playbook", "messages", "cad"];

export function filesRelatedLinks(
  orgId?: string | null,
  options?: { include?: FilesRelatedId[] },
): FilesRelatedLink[] {
  const include = options?.include ? new Set(options.include) : null;
  return FILES_RELATED_LINKS.filter((link) => !include || include.has(link.id)).map((link) => ({
    id: link.id,
    label: link.label,
    href: hubHref(link.hub, link.tab, orgId),
  }));
}
