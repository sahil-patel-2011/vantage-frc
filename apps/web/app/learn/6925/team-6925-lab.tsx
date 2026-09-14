import { Button, PageHeader } from "../../../components/ui";
import { TEAM_6925_RESOURCES, TEAM_6925_WEEKS, totalLabMinutes } from "../../../lib/team-resources/frc6925";
import { withOrgHref } from "../../../lib/nav/product-nav";

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
        description="Official Limelight, WPILib, GitHub, and CAD Video Tutor links, then five paced weeks. Scores stay blank until a real grade exists."
      >
        <nav className="product-hub-related" aria-label="Related coding tools">
          <Button as="a" variant="secondary" href={withOrgHref("/dev-setup", null)}>
            Programming setup
          </Button>
          <Button as="a" variant="secondary" href={withOrgHref("/cad-learn", null)}>
            Learn CAD
          </Button>
          <Button as="a" variant="secondary" href={withOrgHref("/code", null)}>
            Code
          </Button>
        </nav>
      </PageHeader>

      <p className="lab-lead">About {Math.round(totalLabMinutes() / 60)} hours if you do every week in order.</p>

      {TEAM_6925_RESOURCES.map((group) => (
        <section key={group.id} className="lab-unit" id={group.id}>
          <h2>{group.title}</h2>
          <p>{group.blurb}</p>
          <ul className="lab-links">
            {group.links.map((link) => (
              <li key={link.href}>
                <a
                  href={link.href}
                  target={link.href.startsWith("/") ? undefined : "_blank"}
                  rel={link.href.startsWith("/") ? undefined : "noreferrer noopener"}
                  className={link.primary ? "lab-link-primary" : undefined}
                >
                  {link.label}
                  {link.href.startsWith("/") ? null : <span aria-hidden="true"> ↗</span>}
                </a>
              </li>
            ))}
          </ul>
        </section>
      ))}

      {TEAM_6925_WEEKS.map((week) => (
        <section key={week.id} className="lab-unit" id={week.id}>
          <h2>
            Week {week.week} · {week.title}
          </h2>
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
          <ul className="lab-links">
            {week.links.map((link) => (
              <li key={link.href}>
                <a
                  href={link.href.startsWith("/") ? withOrgHref(link.href, null) : link.href}
                  target={link.href.startsWith("/") ? undefined : "_blank"}
                  rel={link.href.startsWith("/") ? undefined : "noreferrer noopener"}
                  className={link.primary ? "lab-link-primary" : undefined}
                >
                  {link.label}
                  {link.href.startsWith("/") ? null : <span aria-hidden="true"> ↗</span>}
                </a>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </main>
  );
}
