"use client";

import { BUGBOT_ULTRA_PRICES_USD } from "@vantage/agent/bugbot";
import { AiHubRelated } from "../../components/ai-hub-related";
import { BuildHubRelated } from "../../components/build-hub-related";
import { EmptyState, Button } from "../../components/ui";
import { MeteredAiCutoffBanner } from "../../components/metered-ai-cutoff-banner";
import { UsageCutoffBanner } from "../../components/usage-cutoff-banner";
import { withOrgHref } from "../../lib/nav/product-nav";
import { CodeBugbotPanel } from "./code-bugbot-panel";
import { CodeCoachPanel } from "./code-coach-panel";
import type { CodeReadyViewProps } from "./code-view-props";

export type { CodeReadyViewProps } from "./code-view-props";

export function CodeReadyView(props: CodeReadyViewProps) {
  const {
    orgId,
    related,
    embedded,
    relatedLinks,
    budgetsHref,
    keysHref,
    githubHref,
    showMeteredBanner,
    cutoffCode,
    nextActions,
    message,
  } = props;
  return (
    <main className={`module-page cdc-page${embedded ? " is-embedded" : ""}`}>
      {!embedded ? (
      <header className="app-page-header">
        <div>
          <span className="breadcrumbs">{related === "ai" ? "AI / Code assist" : "Build / Code"}</span>
          <h1>Code</h1>
          <p>
            Flag risky robot-code patterns, explain why they fail under match pressure, then suggest a safer habit.
            Review runs on this device against a fixed rule set. Every proposed change is a diff a person has to
            approve, and nothing is ever pushed to a robot.
          </p>
        </div>
        <div className="cdc-header-actions">
          <span className="app-badge good">Local · proposal-only</span>
          {orgId ? (
            <Button as="a" variant="secondary" href={withOrgHref("/editor/pair", orgId)}>
              Pair VS Code
            </Button>
          ) : null}
        </div>
      </header>
      ) : null}

      {!embedded ? (
        related === "ai" ? (
          orgId ? <AiHubRelated orgId={orgId} active="code" /> : null
        ) : (
          <BuildHubRelated orgId={orgId} active="code" />
        )
      ) : null}

      {!orgId ? (
        <EmptyState
          soft
          badge="Needs setup"
          badgeTone="setup"
          title="Choose your team"
          description="Local pattern review works without a model key. Pairing VS Code, GitHub context, CAD, and AI chat need a team."
          className="product-hub-setup"
        >
          <Button as="a" variant="primary" href="/workspace">
            Choose your team
          </Button>
        </EmptyState>
      ) : (
        <nav className="cdc-gov" aria-label="CAD, GitHub, and AI chat">
          {relatedLinks.map((link) => (
            <a key={link.id} href={link.href}>
              {link.label}
            </a>
          ))}
          <a href={budgetsHref}>Budgets</a>
          <a href={withOrgHref("/team/usage", orgId)}>AI usage</a>
        </nav>
      )}

      <section className="cdc-billing" aria-label="Local versus metered">
        <article className="cdc-billing-local">
          <span className="app-badge good">Local · free</span>
          <h2>Code pattern review</h2>
          <p>
            Risk rules run in the browser against pasted or loaded source. No provider key, no plan credits, and no
            findings unless a rule matches evidence in your file.
          </p>
        </article>
        <article className="cdc-billing-metered">
          <span className="app-badge">Subscription</span>
          <h2>Bugbot on your plan</h2>
          <p>
            Scan connected GitHub robot-code (or a pasted file) on your team's keys or plan allowance. Findings must
            quote the source. Distinct from CAD briefs and chat.
          </p>
          <div className="cdc-billing-actions">
            <Button as="a" variant="secondary" href="#bugbot">
              AI Bugbot
            </Button>
            <Button as="a" variant="secondary" href={keysHref}>
              AI keys
            </Button>
          </div>
        </article>
        <article className="cdc-billing-ultra">
          <span className="app-badge">Bugbot Ultra</span>
          <h2>Hosted API · published prices</h2>
          <p>
            Straight hosted pass that does not use your team's keys: ${BUGBOT_ULTRA_PRICES_USD.scan.toFixed(2)} to scan, $
            {BUGBOT_ULTRA_PRICES_USD.fix.toFixed(2)} to propose a fix, ${BUGBOT_ULTRA_PRICES_USD.recheck.toFixed(2)} to
            recheck. Fixes stay diffs — never pushed to GitHub.
          </p>
          <div className="cdc-billing-actions">
            <Button as="a" variant="secondary" href="#bugbot">
              Ultra prices
            </Button>
            <Button as="a" variant="secondary" href={githubHref}>
              Connect GitHub
            </Button>
          </div>
        </article>
      </section>

      {showMeteredBanner ? (
        <MeteredAiCutoffBanner orgId={orgId} className="cdc-cutoff" />
      ) : null}
      {cutoffCode ? <UsageCutoffBanner orgId={orgId} errorCode={cutoffCode} className="cdc-cutoff" /> : null}

      <section className="cdc-next-actions app-card soft-panel" aria-label="Next actions">
        <header>
          <h2>Next actions</h2>
          <p className="app-muted">Setup and cross-links.</p>
        </header>
        <ol>
          {nextActions.map((action) => (
            <li key={action.id} className={action.primary ? "primary" : undefined}>
              <div>
                <strong>{action.label}</strong>
                <span>{action.detail}</span>
              </div>
              <Button as="a" variant="secondary" href={action.href}>
                Open
              </Button>
            </li>
          ))}
        </ol>
      </section>

      <section className="cdc-flow" aria-label="Teach, don't just do">
        <article>
          <b>01 · Flag</b>
          <h2>Catch the risky line</h2>
          <p>Blocking loops, hard-coded CAN IDs, unbounded motor output, missing units, disabled-state writes.</p>
        </article>
        <article>
          <b>02 · Explain</b>
          <h2>Why it fails on match day</h2>
          <p>Each finding carries a teaching note so students learn the failure mode — not just a red underline.</p>
        </article>
        <article>
          <b>03 · Correct pattern</b>
          <h2>Suggest a safer habit</h2>
          <p>WPILib-aligned alternatives stay reviewable. Mentors approve diffs; simulation stays with the team.</p>
        </article>
      </section>

      {message ? (
        <p role="status" className="telemetry-status">
          {message}
        </p>
      ) : null}

      <CodeCoachPanel {...props} />
      <CodeBugbotPanel {...props} />
    </main>
  );
}
