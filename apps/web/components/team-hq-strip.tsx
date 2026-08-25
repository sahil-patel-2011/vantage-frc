import { teamHqLinks, type TeamHqId } from "../lib/team/team-hq";

export function TeamHqStrip({
  orgId,
  active,
}: {
  orgId?: string | null;
  active?: TeamHqId;
}) {
  const links = teamHqLinks(orgId, active);
  if (links.length === 0) return null;
  return (
    <nav className="team-hq-strip" aria-label="Team">
      {links.map((link) => (
        <a key={link.id} href={link.href}>
          {link.label}
        </a>
      ))}
    </nav>
  );
}
