import { MARKETING_HUBS } from "../../lib/marketing/product-story";
import { MARKETING_APP_FRAMES, ProductFrame } from "./app-frames";
import { MIcon } from "./marketing-icons";
import { ScoutingDemo } from "./scouting-demo";

export function HomeShowcase() {
  return (
    <>
      <section className="mk-overview-band" aria-label="The Vantage workspace">
        <p>Built around the work.<br /><strong>Connected across the team.</strong></p>
        <span>Home</span><span>Competition</span><span>Team</span><span>Build</span><span>Business</span>
      </section>
      <section className="lux-runs" id="how-it-works" aria-labelledby="lux-runs-title">
        <div className="lux-content">
          <header className="lux-section-head">
            <p className="lux-eyebrow">The whole season</p>
            <h2 id="lux-runs-title">More than match day.</h2>
            <p>Scouting, shop work, schedules and sponsorships. Each has a home; everyone stays on the same team.</p>
          </header>
          <ul className="mk-pillars">
            {MARKETING_HUBS.map((hub) => (
              <li key={hub.id}><a className="mk-pillar-link" href={hub.href}>
                <span className="lux-card-icon"><MIcon name={hub.icon} /></span>
                <strong>{hub.title}</strong><span className="mk-pillar-copy">{hub.promise}</span>
                <span className="mk-pillar-mods">{hub.modules.map((mod) => <span key={mod}>{mod}</span>)}</span>
                <span className="mk-explore">Explore {hub.title.toLowerCase()} <span aria-hidden="true">↗</span></span>
              </a></li>
            ))}
          </ul>
        </div>
      </section>
      <section className="lux-pillars mk-app-gallery" aria-labelledby="lux-app-frames">
        <div className="lux-content">
          <header className="lux-section-head">
            <p className="lux-eyebrow">Scouting with a purpose</p>
            <h2 id="lux-app-frames">From the stands to the strategy table.</h2>
            <p>Collect observations. Compare robots. Make your plan.
              Prepare forms online, collect offline, and upload when you reconnect.</p>
          </header>
          <ul className="mk-app-gallery-grid">
            {MARKETING_APP_FRAMES.map((frame) => (
              <li key={frame.id}><ProductFrame id={frame.id} /><strong>{frame.title}</strong><span>{frame.copy}</span></li>
            ))}
          </ul>
          <p className="mk-related-links"><a href="/features/strategy">Explore scouting and strategy →</a></p>
        </div>
      </section>
      <ScoutingDemo />
      <section className="lux-fit" aria-labelledby="lux-trust-title">
        <div className="lux-content">
          <header className="lux-section-head">
            <p className="lux-eyebrow">Fits your team</p>
            <h2 id="lux-trust-title">Keep the tools you build with.</h2>
            <p>Onshape, Fusion and GitHub remain your specialist environments. Vantage brings their connections
              alongside the people, plans and records around the robot.</p>
          </header>
          <ul className="lux-feature-grid">
            <li><span className="lux-card-icon"><MIcon name="key" /></span><strong>AI is optional</strong>
              <span>Use team tools on their own. For AI assistance, connect your personal Codex or a supported provider key. Provider costs and limits are separate.</span></li>
            <li><span className="lux-card-icon"><MIcon name="users" /></span><strong>A place for each role</strong>
              <span>Owners manage membership and permissions. Students, mentors and leads work within the access their team gives them.</span></li>
            <li><span className="lux-card-icon"><MIcon name="table" /></span><strong>Know where your data lives</strong>
              <span>Vantage uses PostgreSQL with operator-controlled Google Sheets copies. Read about storage, access and AI preferences in the <a href="/privacy">Privacy Policy</a>.</span></li>
          </ul>
          <p className="mk-related-links"><a href="/for-teams">Find your role</a> · <a href="/workflow">Walk through a season</a> · <a href="/pricing">Understand the costs</a></p>
        </div>
      </section>
    </>
  );
}
