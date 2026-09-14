import { Button, PageHeader } from "../../../components/ui";
import { ROBOTICS_STARTER_PACK, starterPackCursorAsk } from "../../../lib/agent-config/robotics-starter-pack";
import {
  AGENT_PROMPT_TEMPLATES,
  SHOP_TUTORIALS,
  cursorPackAskPrompt,
  totalShopTutorialMinutes,
} from "../../../lib/team-resources/shop-tutorials";
import { withOrgHref } from "../../../lib/nav/product-nav";

export function ShopLab() {
  return (
    <main className="module-page lab-page">
      <PageHeader
        breadcrumbs={
          <>
            <a href={withOrgHref("/build")}>Build</a>
            {" / Shop lab"}
          </>
        }
        title="Shop lab"
        description="One Limelight, GitHub push and pull, Cursor rules and skills, and prompts that do one job. Numbers stay blank until the camera page, CAD, or a lead fills them."
      >
        <nav className="product-hub-related" aria-label="Related coding tools">
          <Button as="a" variant="primary" href={withOrgHref("/learn/6925")}>
            Team 6925 lab
          </Button>
          <Button as="a" variant="secondary" href={withOrgHref("/cad-learn")}>
            Learn CAD
          </Button>
          <Button as="a" variant="secondary" href={withOrgHref("/team/agent-config")}>
            Team agent config
          </Button>
        </nav>
      </PageHeader>

      <p className="lab-lead">
        About {Math.round(totalShopTutorialMinutes() / 60)} hours if you do every tutorial in order.
      </p>

      {SHOP_TUTORIALS.map((tutorial) => (
        <section key={tutorial.id} className="lab-unit" id={tutorial.id}>
          <h2>{tutorial.title}</h2>
          <p>{tutorial.blurb}</p>
          <ol>
            {tutorial.steps.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
          <p className="lab-verify">
            <strong>Done when: </strong>
            {tutorial.verify}
          </p>
          <p className="lab-minutes">{tutorial.minutes} minutes</p>
          <ul className="lab-links">
            {tutorial.links.map((link) => (
              <li key={link.href}>
                <a
                  href={link.href.startsWith("/") ? withOrgHref(link.href) : link.href}
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

      <section className="lab-unit" id="cursor-ask">
        <h2>Ask Cursor to add the pack</h2>
        <p>
          After a lead saves the pack under Team agent config — or after you paste the rules and skills
          below — send Cursor this and nothing else.
        </p>
        <pre className="lab-prompt">{cursorPackAskPrompt()}</pre>
        <p className="app-muted">{starterPackCursorAsk()}</p>
      </section>

      <section className="lab-unit" id="starter-pack">
        <h2>Robotics rules and skills</h2>
        <p>
          Copy these into Team agent config, then sync with Cursor. Spec blanks stay empty until CAD or
          the cart fills them.
        </p>
        {ROBOTICS_STARTER_PACK.map((item) => (
          <article key={item.name} className="lab-pack-item">
            <h3>
              {item.kind === "rules" ? "Rule" : "Skill"} · {item.name}
            </h3>
            <p>{item.description}</p>
            <pre className="lab-prompt">{item.markdown}</pre>
          </article>
        ))}
      </section>

      <section className="lab-unit" id="agent-prompts">
        <h2>Saved prompts — one job each</h2>
        {AGENT_PROMPT_TEMPLATES.map((template) => (
          <article key={template.id} className="lab-pack-item">
            <h3>{template.title}</h3>
            <pre className="lab-prompt">{template.body}</pre>
          </article>
        ))}
      </section>
    </main>
  );
}
