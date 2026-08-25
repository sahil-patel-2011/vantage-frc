/**
 * Marketing Soft-UI hero preview + optional hub directory for /features.
 * Hub names match Soft-UI pillars. No DEMO metrics or status chips.
 */

const hubs = [
  {
    id: "competition",
    title: "Competition",
    href: "/features",
    modules: ["Command", "Scouting", "Strategy"],
  },
  {
    id: "team",
    title: "Team",
    href: "/for-teams",
    modules: ["Calendar", "Team chat", "Todos"],
  },
  {
    id: "business",
    title: "Business",
    href: "/pricing",
    modules: ["Budget", "Sponsors", "Orders"],
  },
  {
    id: "build",
    title: "Build",
    href: "/features/cad",
    modules: ["Kickoff", "CAD", "Code"],
  },
  {
    id: "ai",
    title: "AI",
    href: "/pricing",
    modules: ["Chat", "Writer", "API keys"],
  },
  {
    id: "media",
    title: "Media",
    href: "/for-teams",
    modules: ["Calendar", "Drafts", "Media kit"],
  },
] as const;

/** Hub directory used on /features — not on the homepage (homepage uses a quieter strip). */
export function ProductGlances() {
  return (
    <div className="product-glances" aria-label="Product hubs">
      {hubs.map((hub) => (
        <article className="product-glance" key={hub.id}>
          <h3>
            <a href={hub.href}>{hub.title}</a>
          </h3>
          <ul className="product-glance-modules">
            {hub.modules.map((mod) => (
              <li key={mod}>{mod}</li>
            ))}
          </ul>
        </article>
      ))}
    </div>
  );
}

