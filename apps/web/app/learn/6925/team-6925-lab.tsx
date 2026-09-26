import { PageHeader } from "../../../components/ui";
import {
  LAB_TRACKS,
  TEAM_6925_REPO,
  TEAM_6925_SETUP_COMMAND,
  TEAM_6925_STACK,
  resourcesForTrack,
  taskCheckLabel,
  trackMinutes,
  weeksForTrack,
  type PacedWeek,
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

function hoursText(minutes: number): string {
  const hours = Math.round((minutes / 60) * 2) / 2;
  return `${hours} hour${hours === 1 ? "" : "s"}`;
}

/** One week: why it matters, then its small steps, each with how it is checked. */
function Week({ week }: { week: PacedWeek }) {
  const automatic = week.tasks.filter((task) => task.check.kind !== "lead-signoff").length;
  return (
    <section className="lab-unit lab-week" id={week.id} aria-labelledby={`${week.id}-title`}>
      <h4 id={`${week.id}-title`}>
        Week {week.week} · {week.title}
      </h4>
      <p>{week.why}</p>
      <p className="lab-minutes">
        About {hoursText(week.minutes)} · {week.tasks.length} steps
        {automatic ? ` · ${automatic} checked by Vantage` : " · signed off by a lead"}
      </p>
      <ol className="lab-tasks">
        {week.tasks.map((task, index) => {
          const label = taskCheckLabel(task);
          return (
            <li key={task.id} className="lab-task" id={task.id}>
              <details>
                <summary>
                  <span className="lab-task-number" aria-hidden="true">
                    {index + 1}
                  </span>
                  <span className="lab-task-title">{task.title}</span>
                  <span className={`lab-task-badge${label === "A lead signs off" ? " is-lead" : ""}`}>{label}</span>
                </summary>
                <div className="lab-task-body">
                  <p className="lab-task-why">{task.why}</p>
                  <ol className="lab-task-do">
                    {task.do.map((line) => (
                      <li key={line}>{line}</li>
                    ))}
                  </ol>
                  <p className="lab-task-check">
                    <strong>How it&apos;s checked: </strong>
                    {task.checkedBy}
                  </p>
                  {task.links?.length ? <LabLinks links={task.links} /> : null}
                </div>
              </details>
            </li>
          );
        })}
      </ol>
      <p className="lab-verify">
        <strong>Done when: </strong>
        {week.doneWhen}
      </p>
      <LabLinks links={week.links} />
    </section>
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
        description="Two paced tracks for W.A. Robotics: programming, and mechanical and CAD. Every week is split into small steps, and every step says how it is checked before it counts."
      >
        <nav className="product-hub-related" aria-label="Related coding tools">
          <a href={withOrgHref("/dev-setup", null)}>Programming setup</a>
          <a href={withOrgHref("/cad-learn", null)}>Learn CAD</a>
          <a href={withOrgHref("/code", null)}>Code</a>
        </nav>
      </PageHeader>

      <nav className="lab-track-nav" aria-label="Lab tracks">
        {LAB_TRACKS.map((track) => (
          <a key={track.id} href={`#${track.id}`}>
            {track.title}
          </a>
        ))}
      </nav>

      {LAB_TRACKS.map((track) => {
        const weeks = weeksForTrack(track.id);
        const steps = weeks.reduce((sum, week) => sum + week.tasks.length, 0);
        return (
          <section key={track.id} className="lab-track" id={track.id} aria-labelledby={`${track.id}-title`}>
            <header className="lab-track-head">
              <h2 id={`${track.id}-title`}>{track.title}</h2>
              <p>{track.blurb}</p>
              <p className="lab-lead">
                {weeks.length} weeks, {steps} steps, about {Math.round(trackMinutes(track.id) / 60)} hours in order.
              </p>
              {/* The same steps, one at a time, each checked before it counts. */}
              <a className="lab-start" href={`/learn/guided/frc6925-${track.id}`}>
                Start the checked steps
              </a>
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

            {track.id === "programming" ? (
              <section className="lab-stack" aria-labelledby="lab-stack-title">
                <h3 id="lab-stack-title">What the team's robot code uses</h3>
                <p>Read from the 2026 robot code on GitHub. The steps below use these exact libraries.</p>
                <dl>
                  {TEAM_6925_STACK.map((row) => (
                    <div key={row.label}>
                      <dt>{row.label}</dt>
                      <dd>{row.value}</dd>
                    </div>
                  ))}
                </dl>
                <LabLinks links={[{ label: "Open the 2026 robot code", href: TEAM_6925_REPO }]} />
              </section>
            ) : null}

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
              <Week key={week.id} week={week} />
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
