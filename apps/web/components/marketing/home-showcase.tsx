/**
 * Homepage show-off sections. Product frames describe the interface, never invented scores.
 * Styles live in app/marketing-showcase.css (.shx-* namespace).
 */

const PIPELINE = [
  {
    step: "Scout",
    title: "Works offline",
    copy: "Match and pit forms stay on the tablet. Sync starts again when the venue network comes back.",
  },
  {
    step: "Check",
    title: "Two scouts, one call",
    copy: "When two entries disagree, you resolve the field. Coverage and scout accuracy are tracked.",
  },
  {
    step: "Project",
    title: "Seed odds, labeled",
    copy: "Projected seed bands and district points from the remaining schedule — assumptions sit on the page.",
  },
  {
    step: "Pick",
    title: "Alliance desk",
    copy: "A ranked board from your scout data and public facts, with a pick clock for selection day.",
  },
] as const;

const DEPTH = [
  {
    title: "Build the robot",
    copy: "Kickoff analysis, Onshape and Fusion CAD agent, Code Coach, AI Bugbot, FMEA, batteries, inspection.",
    modules: ["Kickoff", "CAD agent", "Code Coach", "Bugbot", "FMEA", "Inspection"],
    href: "/features/cad",
  },
  {
    title: "Run the team",
    copy: "Calendar, practice, attendance, knowledge, packing, and duty rosters that survive graduation.",
    modules: ["Calendar", "Attendance", "Knowledge", "Packing", "Duty roster", "Season plan"],
    href: "/for-teams",
  },
  {
    title: "Fund the season",
    copy: "Budget against real costs, a sponsor pipeline, grants, and award evidence in one hub.",
    modules: ["Budget", "Sponsors", "Grants", "Orders", "Award evidence", "Impact log"],
    href: "/for-teams",
  },
] as const;

const STACK = [
  { before: "Scouting spreadsheet", after: "Match & pit scouting", need: "Match data" },
  { before: "Group chat threads", after: "Team chat + alerts", need: "Coordination" },
  { before: "TBA tabs all day", after: "Command + schedule", need: "Event day" },
  { before: "Whiteboard photos", after: "Strategy + pick desk", need: "Alliance picks" },
  { before: "A stale budget doc", after: "Budget + sponsors", need: "Money" },
  { before: "CAD in DMs", after: "CAD agent + reviews", need: "The robot" },
] as const;

export function HomeShowcase() {
  return (
    <>
      <section className="shx-consolidate" aria-labelledby="shx-consolidate-title">
        <div className="lux-content">
          <header className="lux-section-head">
            <h2 id="shx-consolidate-title">Saturday used to mean ten tabs.</h2>
            <p>Sheets, group chats, TBA, whiteboard photos, and a budget nobody updates — replaced by one workspace.</p>
          </header>
          <ul className="shx-stack">
            {STACK.map((row) => (
              <li key={row.need} className="shx-stack-row">
                <span className="shx-stack-need">{row.need}</span>
                <span className="shx-stack-before">{row.before}</span>
                <span className="shx-stack-arrow" aria-hidden="true">
                  →
                </span>
                <span className="shx-stack-after">{row.after}</span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="shx-pipeline" aria-labelledby="shx-pipeline-title">
        <div className="lux-content">
          <header className="lux-section-head">
            <h2 id="shx-pipeline-title">Scout. Check. Project. Pick.</h2>
            <p>The competition loop is one workspace, and each stage feeds the next.</p>
          </header>
          <ol className="shx-pipeline-grid shx-pipeline-copy">
            {PIPELINE.map((item, index) => (
              <li className="shx-stage" key={item.step}>
                <div className="shx-stage-label">
                  <b>{String(index + 1).padStart(2, "0")}</b>
                  <span>{item.step}</span>
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
            <p>Competition is six weekends. Vantage covers what happens between them.</p>
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

      <section className="shx-closer" aria-labelledby="shx-closer-title">
        <div className="lux-content shx-closer-inner">
          <div>
            <h2 id="shx-closer-title">Invite-only for FRC teams.</h2>
            <p>Start with your own AI keys. Add hosted credits when you want them.</p>
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
