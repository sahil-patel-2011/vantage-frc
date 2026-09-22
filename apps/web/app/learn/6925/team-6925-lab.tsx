import { PageHeader } from "../../../components/ui";
import {
  LAB_TRACKS,
  TEAM_6925_SETUP_COMMAND,
  resourcesForTrack,
  trackMinutes,
  weeksForTrack,
  type TeamResourceLink,
} from "../../../lib/team-resources/frc6925";
import { CopyCommand } from "./copy-command";
import { withOrgHref } from "../../../lib/nav/product-nav";

function LabLinks({ links }: { links: TeamResourceLink[] }) {
  return (
    <ul className="lab-links">
      {links.map((link) => {
        const inApp = link.href.startsWith("/");
        return (
          <li key={link.href}>
            <a
              href={inApp ? withOrgHref(link.href, null) : link.href}
              target={inApp ? undefined : "_blank"}
              rel={inApp ? undefined : "noreferrer noopener"}
              className={link.primary ? "lab-link-primary" : undefined}
            >
              {link.label}
              {inApp ? null : <span aria-hidden="true"> ↗</span>}
            </a>
          </li>
        );
      })}
    </ul>
  );
}

export function Team6925Lab() {
  return (
    <main className="module-page lab-page">
      <PageHeader
        breadcrumbs={
          <>
            <a href={withOrgHref("/build", null)}>Build</a>
            {" / Team 6925 lab"}
          </>
        }
        title="Team 6925 lab"
        description="Two paced tracks — programming and mechanical. Each week says why it matters, what to do, and how you know you are done. Scores stay blank until a real grade exists."
      >
        <nav className="product-hub-related" aria-label="Related coding tools">
          <a href={withOrgHref("/dev-setup", null)}>Programming setup</a>
          <a href={withOrgHref("/cad-learn", null)}>Learn CAD</a>
          <a href={withOrgHref("/code", null)}>Code</a>
        </nav>
      </PageHeader>

      <nav className="lab-track-nav" aria-label="Lab tracks">
        {LAB_TRACKS.map((track, index) => (
          <span key={track.id}>
            {index > 0 ? <span aria-hidden="true"> · </span> : null}
            <a href={`#${track.id}`}>{track.title}</a>
          </span>
        ))}
      </nav>

      {LAB_TRACKS.map((track) => {
        const weeks = weeksForTrack(track.id);
        return (
          <section key={track.id} className="lab-track" id={track.id} aria-labelledby={`${track.id}-title`}>
            <header className="lab-track-head">
              <h2 id={`${track.id}-title`}>{track.title} track</h2>
              <p>{track.blurb}</p>
              <p className="lab-lead">
                {weeks.length} weeks, about {Math.round(trackMinutes(track.id) / 60)} hours if you do every week in
                order.
              </p>
              <ol className="lab-week-index" aria-label={`${track.title} weeks`}>
                {weeks.map((week) => (
                  <li key={week.id}>
                    <a href={`#${week.id}`}>
                      Week {week.week} · {week.title}
                    </a>
                  </li>
                ))}
              </ol>
            </header>

            <h3 className="lab-subhead">Open these first</h3>
            {resourcesForTrack(track.id).map((group) => (
              <section key={group.id} className="lab-unit" id={group.id}>
                <h4>{group.title}</h4>
                <p>{group.blurb}</p>
                {group.id === "laptop-setup" ? (
                  <CopyCommand command={TEAM_6925_SETUP_COMMAND} label="Open PowerShell and run:" />
                ) : null}
                <LabLinks links={group.links} />
              </section>
            ))}

            <h3 className="lab-subhead">Weeks</h3>
            {weeks.map((week) => (
              <section key={week.id} className="lab-unit" id={week.id}>
                <h4>
                  Week {week.week} · {week.title}
                </h4>
                <p>{week.why}</p>
                <ol>
                  {week.steps.map((step) => (
                    <li key={step}>{step}</li>
                  ))}
                </ol>
                <p className="lab-verify">
                  <strong>Done when: </strong>
                  {week.verify}
                </p>
                <p className="lab-minutes">{week.minutes} minutes</p>
                <LabLinks links={week.links} />
              </section>
            ))}

            <p className="lab-back">
              <a href="#top">Back to the top</a>
            </p>
          </section>
        );
      })}
    </main>
  );
}
