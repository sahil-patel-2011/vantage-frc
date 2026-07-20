/**
 * Homepage show-off sections. Same rules as the rest of marketing: real module
 * names, honest empty states in every product frame, zero invented metrics.
 * Styles live in app/marketing-showcase.css (.shx-* namespace).
 */

const PIPELINE = [
  {
    step: "Scout",
    title: "Offline-first scouting",
    copy: "Match and pit forms cache on every device and sync when the venue Wi-Fi comes back.",
    frame: {
      header: "Scouting · Outbox",
      rows: ["Match form · queued on device", "Pit form · queued on device", "Sync resumes when online"],
      footer: "OFFLINE · entries held locally",
    },
  },
  {
    step: "Validate",
    title: "Data you can defend",
    copy: "Dual-scout disagreements get flagged and resolved; coverage and scout accuracy are tracked, not assumed.",
    frame: {
      header: "Scout Disagreements",
      rows: ["Two entries disagree on a field", "Side-by-side resolution", "Accuracy feeds scout weighting"],
      footer: "Empty until two scouts disagree",
    },
  },
  {
    step: "Project",
    title: "Seed & district odds",
    copy: "Monte Carlo over the remaining schedule: projected seed bands, top-8 odds, and district-point value — assumptions stated on the page.",
    frame: {
      header: "Ranking Projection",
      rows: ["Projected seed · p10–p90 band", "Top-8 / captain odds", "District points band at the live event"],
      footer: "Needs a synced schedule — no schedule, no numbers",
    },
  },
  {
    step: "Pick",
    title: "Alliance Selection Desk",
    copy: "Pick lists built from your scout data and public facts, with a live desk for selection day.",
    frame: {
      header: "Alliance Selection Desk",
      rows: ["Ranked board with sources", "Strike-through as teams go", "Pick clock beside the desk"],
      footer: "Sources shown on every candidate",
    },
  },
] as const;

const DEPTH = [
  {
    title: "Build the robot",
    copy: "Kickoff analysis, a CAD agent for Onshape and Fusion 360, Code Coach, FMEA failure log, battery fleet, inspection and weigh-in.",
    modules: ["Kickoff", "CAD agent", "Code Coach", "FMEA", "Batteries", "Inspection"],
    href: "/features/cad",
  },
  {
    title: "Run the team",
    copy: "Season calendar, practice and attendance, knowledge base, packing lists, duty rosters, and event logistics that survive graduation.",
    modules: ["Calendar", "Attendance", "Knowledge", "Packing", "Duty Roster", "Season Planning"],
    href: "/for-teams",
  },
  {
    title: "Fund the season",
    copy: "Budget against real costs, a sponsor pipeline built for teams that can't get nonprofit CRMs, grants, and award evidence.",
    modules: ["Budget", "Sponsors", "Grants", "Orders", "Award evidence", "Impact log"],
    href: "/for-teams",
  },
] as const;

const HONESTY = [
  {
    title: "Empty until your data connects",
    copy: "Every module ships with a setup state, not demo numbers. If TBA isn't linked, the dashboard says so.",
  },
  {
    title: "Every number has a source",
    copy: "Ranks and EPA come from The Blue Alliance and Statbotics sync; scouting stats come from your scouts. Provenance is shown in the UI.",
  },
  {
    title: "Models state their assumptions",
    copy: "Projections list what's simulated and what isn't — win/tie RPs modeled, bonus RPs excluded and labeled — so a number is never more confident than the data behind it.",
  },
] as const;

const INTEGRATIONS = [
  "The Blue Alliance",
  "Statbotics",
  "Onshape",
  "Fusion 360",
  "GitHub",
  "Discord",
  "Google sign-in",
  "Stripe",
] as const;

/** The fragmented "Saturday stack" a team juggles today → the Vantage surface that replaces it. */
const STACK = [
  { before: "Scouting spreadsheet", after: "Scouting + Coverage", need: "Match & pit data" },
  { before: "Group chat threads", after: "Team chat + Notifications", need: "Coordination" },
  { before: "TBA tabs open all day", after: "Matches, Ranking Projection", need: "Live event data" },
  { before: "Whiteboard photos", after: "Strategy + Alliance Desk", need: "Match & pick plans" },
  { before: "A budget doc nobody updates", after: "Budget + Sponsors + Grants", need: "Money & funding" },
  { before: "CAD screenshots in DMs", after: "CAD agent + Design reviews", need: "The robot" },
] as const;

export function HomeShowcase() {
  return (
    <>
      <section className="shx-consolidate" aria-labelledby="shx-consolidate-title">
        <div className="lux-content">
          <header className="lux-section-head">
            <h2 id="shx-consolidate-title">Ten tabs on Saturday. One workspace instead.</h2>
            <p>
              The tools FRC teams duct-tape together — sheets, group chats, TBA, whiteboard photos, budget docs —
              in one place that actually talks to itself.
            </p>
          </header>
          <ul className="shx-stack">
            {STACK.map((row) => (
              <li key={row.need} className="shx-stack-row">
                <span className="shx-stack-need">{row.need}</span>
                <span className="shx-stack-before">{row.before}</span>
                <span className="shx-stack-arrow" aria-hidden="true">→</span>
                <span className="shx-stack-after">{row.after}</span>
              </li>
            ))}
          </ul>
          <p className="shx-consolidate-note">
            One org context, one sign-in, one bill — instead of six subscriptions and a folder of spreadsheets.
          </p>
        </div>
      </section>

      <section className="shx-pipeline" aria-labelledby="shx-pipeline-title">
        <div className="lux-content">
          <header className="lux-section-head">
            <h2 id="shx-pipeline-title">From scout tablet to alliance pick.</h2>
            <p>The whole competition loop lives in one workspace — each stage feeds the next.</p>
          </header>
          <ol className="shx-pipeline-grid">
            {PIPELINE.map((item, index) => (
              <li className="shx-stage" key={item.step}>
                <div className="shx-stage-label">
                  <b>{String(index + 1).padStart(2, "0")}</b>
                  <span>{item.step}</span>
                </div>
                <div className="shx-frame" role="img" aria-label={`${item.frame.header} preview`}>
                  <div className="shx-frame-bar">
                    <i />
                    <i />
                    <i />
                    <em>{item.frame.header}</em>
                  </div>
                  <ul>
                    {item.frame.rows.map((row) => (
                      <li key={row}>{row}</li>
                    ))}
                  </ul>
                  <small>{item.frame.footer}</small>
                </div>
                <strong>{item.title}</strong>
                <p>{item.copy}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="shx-depth" aria-labelledby="shx-depth-title">
        <div className="lux-content">
          <header className="lux-section-head">
            <h2 id="shx-depth-title">The other forty weeks, too.</h2>
            <p>Competition season is six weekends. Vantage covers what happens between them.</p>
          </header>
          <div className="shx-depth-grid">
            {DEPTH.map((column) => (
              <a className="shx-depth-card" key={column.title} href={column.href}>
                <strong>{column.title}</strong>
                <p>{column.copy}</p>
                <ul>
                  {column.modules.map((module) => (
                    <li key={module}>{module}</li>
                  ))}
                </ul>
                <span className="shx-depth-more">Explore →</span>
              </a>
            ))}
          </div>
        </div>
      </section>

      <section className="shx-honesty" aria-labelledby="shx-honesty-title">
        <div className="lux-content">
          <header className="lux-section-head">
            <h2 id="shx-honesty-title">No fabricated numbers. Anywhere.</h2>
            <p>The rule that shapes every screen: show real data, or show the setup path to it.</p>
          </header>
          <div className="shx-honesty-grid">
            {HONESTY.map((item) => (
              <article key={item.title}>
                <strong>{item.title}</strong>
                <p>{item.copy}</p>
              </article>
            ))}
          </div>
          <ul className="shx-integrations" aria-label="Integrations">
            {INTEGRATIONS.map((name) => (
              <li key={name}>{name}</li>
            ))}
          </ul>
        </div>
      </section>

      <section className="shx-closer" aria-labelledby="shx-closer-title">
        <div className="lux-content shx-closer-inner">
          <div>
            <h2 id="shx-closer-title">Bring your whole season into one place.</h2>
            <p>Invite-only for FRC teams. Start with your own AI keys free, add hosted credits when you want them.</p>
          </div>
          <div className="shx-closer-actions">
            <a className="button primary" href="#waitlist">
              Join the waitlist
            </a>
            <a className="button secondary" href="/features">
              See the product
            </a>
          </div>
        </div>
      </section>
    </>
  );
}
