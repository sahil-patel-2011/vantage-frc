/**
 * Quiet marketing product glances — Soft-UI surface names + short blurbs.
 * Preview chrome only; signed-in product stays empty until real data.
 */

const panels = [
  {
    id: "scouting",
    title: "Scouting",
    copy: "Offline match/pit forms, voice notes, sync.",
    frame: "Scouting hub",
    lines: ["Form builder · published", "Voice note · opt-in", "Offline · outbox ready"],
  },
  {
    id: "event-day",
    title: "Event Day",
    copy: "Command + My Day for the whole crew.",
    frame: "Command",
    lines: ["Next match · from TBA", "Checklist · pit run", "Empty until event linked"],
  },
  {
    id: "strategy",
    title: "Strategy & picks",
    copy: "Alliance Selection Desk and Pick clock.",
    frame: "Pick desk",
    lines: ["Shared alliance slots", "Scout evidence attached", "No DEMO win rates"],
  },
  {
    id: "cad",
    title: "CAD agent",
    copy: "Approval-gated brief → Onshape or Fusion.",
    frame: "CAD brief",
    lines: ["Human checkpoints", "Setup when connected", "Empty until OAuth"],
  },
  {
    id: "season",
    title: "Season planning",
    copy: "Goals, milestones, owners on Soft-UI.",
    frame: "Season workspace",
    lines: ["Milestones · owners", "Calendar hooks", "Progress from real logs"],
  },
  {
    id: "ops",
    title: "Team & Business",
    copy: "Logistics, sponsors, grants, knowledge.",
    frame: "Business hub",
    lines: ["Travel · lodging", "Sponsor pipeline", "Grants · drafts"],
  },
] as const;

export function ProductGlances() {
  return (
    <div className="product-glances product-glances-dense" aria-label="Marketing product previews">
      {panels.map((panel) => (
        <article className="product-glance" key={panel.id}>
          <h3>{panel.title}</h3>
          <p>{panel.copy}</p>
          <div className="product-glance-frame" aria-hidden="true">
            <header>
              <span>{panel.frame}</span>
              <b>Preview</b>
            </header>
            <ul>
              {panel.lines.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </div>
        </article>
      ))}
      <p className="product-glances-note">
        Marketing preview. Signed-in workspaces stay empty until TBA / scouts connect.
      </p>
    </div>
  );
}

export function HeroProductVisual() {
  return (
    <div className="hero-product-visual" aria-hidden="true">
      <div className="hero-product-screen">
        <header>
          <span>Vantage</span>
          <b>Competition</b>
        </header>
        <div className="hero-product-body">
          <div className="hero-product-row">
            <span>Event Day</span>
            <strong>Command · My Day</strong>
          </div>
          <div className="hero-product-row muted">
            <span>Scouting</span>
            <strong>Offline · voice</strong>
          </div>
          <div className="hero-product-row muted">
            <span>Strategy</span>
            <strong>Pick desk</strong>
          </div>
          <div className="hero-product-row muted">
            <span>Assistant</span>
            <strong>Sources labeled</strong>
          </div>
        </div>
      </div>
    </div>
  );
}
