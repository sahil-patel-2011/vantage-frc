/**
 * Quiet marketing product glances — title, one sentence, calm composition.
 * Labeled as marketing preview only; signed-in product stays empty until real data.
 */

const panels = [
  {
    id: "scouting",
    title: "Scouting",
    copy: "Match and pit forms that keep working offline—then sync with attribution.",
    frame: "Match form",
    lines: ["Auto · observed", "Tele · observed", "Voice note · attached"],
  },
  {
    id: "strategy",
    title: "Strategy",
    copy: "Win/loss and playbooks built from real event and scout facts—never DEMO win rates.",
    frame: "Alliance brief",
    lines: ["Evidence-weighted picks", "Playbook for drive team", "Empty until data exists"],
  },
  {
    id: "cad",
    title: "CAD",
    copy: "Kickoff intent becomes an approval-gated brief before geometry changes.",
    frame: "CAD brief",
    lines: ["Human checkpoints", "Onshape or Fusion", "Setup when connected"],
  },
] as const;

export function ProductGlances() {
  return (
    <div className="product-glances" aria-label="Marketing product previews">
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
        Marketing preview. Signed-in workspaces stay empty until your event and data exist.
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
            <span>Next match</span>
            <strong>Qual 24</strong>
          </div>
          <div className="hero-product-row muted">
            <span>Readiness</span>
            <strong>Shared with crew</strong>
          </div>
          <div className="hero-product-row muted">
            <span>Scouting</span>
            <strong>Synced facts</strong>
          </div>
        </div>
      </div>
    </div>
  );
}
