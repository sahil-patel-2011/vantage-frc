import type { Metadata } from "next";
import { WaitlistForm } from "../components/marketing/waitlist-form";
import { SiteFooter, SiteHeader } from "../components/marketing/site-header";
import { FAQ } from "../components/marketing/faq";
import { HeroProductPanel } from "../components/marketing/hero-product";
import { PricingStrip } from "../components/marketing/pricing-strip";
import { ScrollReveal } from "../components/marketing/scroll-reveal";
import { MIcon, type MIconName } from "../components/marketing/marketing-icons";
import { marketingPageMetadata, organizationSoftwareJsonLd } from "../lib/marketing/seo";

export const metadata: Metadata = marketingPageMetadata({
  title: "Vantage — the AI mentor for FRC teams",
  description:
    "One workspace for a FIRST Robotics Competition season — scouting, strategy, event day, build, and the business side — with an AI that does real work and never hands a student an answer they haven’t called. Invite-only.",
  path: "/",
});

/** Where a season actually goes today. No statistics — just the three places. */
const problems: readonly { icon: MIconName; title: string; copy: string }[] = [
  {
    icon: "chat",
    title: "Discord scroll",
    copy: "The decision that mattered is four hundred messages up. In week five nobody can find it, so the team makes it again.",
  },
  {
    icon: "table",
    title: "Six spreadsheets",
    copy: "Scouting in one, the budget in another, the battery log on a laptop in the pit, the pick list on paper at the table.",
  },
  {
    icon: "cap",
    title: "A graduating senior",
    copy: "The person who knows why the intake is geared like that walks out in June, and the reasoning walks out with them.",
  },
] as const;

/** Three steps, in the order a team actually experiences them. */
const steps = [
  {
    step: "1",
    title: "Provision the team, set the event",
    copy:
      "A platform admin provisions your organization with a verified owner; owners and admins invite exact emails. Link your Blue Alliance key and set the active event once — every hub downstream inherits it.",
  },
  {
    step: "2",
    title: "Run the whole season in one workspace",
    copy:
      "Scouting, strategy, event day, build, team operations and the money share one login, one event context and one set of numbers. Phone-sized controls in the pit, and scouting keeps working when the venue Wi-Fi does not.",
  },
  {
    step: "3",
    title: "Students call the shot; the robot grades it",
    copy:
      "Before a calculator, a CAD operation or a strategy card reveals its result, the student commits a falsifiable prediction. The math, the CAD kernel or the actual match grades it — then the agent teaches from the gap. Mentors are never gated.",
  },
] as const;

/** Product principles, restated as promises. Straight from the concept doc. */
const rules = [
  { lead: "Attempt before answer.", copy: "No teaching surface reveals a result until a student commits a falsifiable prediction — and mentors are never gated." },
  { lead: "The robot is the answer key.", copy: "Feedback comes from the CAD kernel, the calculators’ math and the team’s measured data — never the model’s unverifiable opinion." },
  { lead: "Help fades as skill grows.", copy: "Scaffolds retire themselves per student per skill on demonstrated calibration, and the fading is legible, never sneaky." },
  { lead: "Deadline mode is allowed, never free.", copy: "Week six exists. Every skipped learning moment is logged as a mentor-visible debt with a scheduled repayment." },
  { lead: "Students author the artifact.", copy: "Notebook entries, postmortems and wiki pages are student prose the agent critiques against quoted evidence — not agent prose a student signs." },
  { lead: "No team data, no lesson.", copy: "Honest empty states extend to teaching. Never a canned example wearing your team’s name." },
] as const;

/** Six pillars, each one a real hub in the product. One honest line each. */
const pillars: readonly { icon: MIconName; hub: string; title: string; copy: string }[] = [
  {
    icon: "clipboard",
    hub: "Competition",
    title: "Scouting",
    copy: "Match and pit forms that keep working when the venue Wi-Fi doesn’t — on-device outbox, QR hand-off, a pit mesh between tablets — then sync when the network comes back.",
  },
  {
    icon: "target",
    hub: "Competition",
    title: "Strategy and pick lists",
    copy: "Match predictions, the pick-list desk, the alliance-selection board and defense planning, built from your scouts plus The Blue Alliance and Statbotics. If the data isn’t there, the screen says so.",
  },
  {
    icon: "flag",
    hub: "Competition",
    title: "Event day",
    copy: "Next match, drive-coach briefing, match checklist, pit repair triage with FMEA, battery rotation, inspection and the weigh-in log.",
  },
  {
    icon: "wrench",
    hub: "Build",
    title: "Build season",
    copy: "Kickoff game analysis, the Onshape and Fusion CAD agent, robot-code review, BOM against what’s in the bin, the engineering notebook and the decision log.",
  },
  {
    icon: "calendar",
    hub: "Team",
    title: "Team operations",
    copy: "Calendar with real match times, team chat, roster and invites, attendance and shop hours, the task board, the playbook and the wiki.",
  },
  {
    icon: "coins",
    hub: "Business",
    title: "Money and sponsors",
    copy: "Budget, purchase orders, the sponsor CRM, the grant pipeline, fundraisers, and the outreach and awards log.",
  },
] as const;

/** Commitments a district administrator can check against the product and the policy. */
const trust: readonly { icon: MIconName; title: string; copy: string }[] = [
  {
    icon: "lock",
    title: "Isolated by row-level security",
    copy: "Every request runs through Postgres row-level security scoped to your organization, on a database role separate from background workers. Product code is lint-blocked from the admin role.",
  },
  {
    icon: "shield",
    title: "Supervised by construction",
    copy: "An unsupervised adult–student DM cannot exist, because the data model adds a second adult. Edits and deletes are tombstoned and the transcript exports in one click.",
  },
  {
    icon: "users",
    title: "Roles, not a shared login",
    copy: "Owner, admin, scout and viewer roles with per-hub access, so the budget is not a tab every freshman opens.",
  },
  {
    icon: "table",
    title: "No ads, and nothing sold",
    copy: "No advertising cookies, no session replay, no fingerprinting, no ad networks — and your team’s content is never sold to anyone.",
  },
  {
    icon: "key",
    title: "Bring your own AI keys",
    copy: "Anthropic, OpenAI, Google, OpenRouter or a local Ollama, encrypted per team with envelope encryption. Free provider tiers count. Hosted plans exist for teams that would rather not manage keys.",
  },
  {
    icon: "wifi",
    title: "Works offline at the venue",
    copy: "Scouting runs from a cached shell with an on-device queue, because arena Wi-Fi is not a plan you can build a weekend on.",
  },
] as const;

export default function Home() {
  const entityLd = organizationSoftwareJsonLd();
  return (
    <div className="marketing-site marketing-lux">
      <SiteHeader />
      <ScrollReveal />
      <main>
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(entityLd) }} />

        <section className="lux-hero" aria-labelledby="lux-hero-title">
          <div className="lux-hero-backdrop" aria-hidden="true" />
          <div className="lux-hero-inner">
            <div className="lux-hero-copy">
              <p className="lux-kicker">For FRC teams · Invite-only</p>
              <h1 id="lux-hero-title">An AI that builds with your students, and teaches them why.</h1>
              <p>
                Your FRC team, in one place — scouting, strategy, event day, the build season, and the business side —
                run by an agent that does real work and refuses to hand over an answer nobody called.
              </p>
              <div className="actions">
                <a className="button primary" href="#waitlist">
                  Request access
                </a>
                <a className="button secondary" href="#how-it-works">
                  See how it works
                </a>
              </div>
              <p className="lux-hero-note">
                FIRST is an education program, so the copilot is built to make itself unnecessary. Nothing on this page
                is live team data; every surface stays empty until your team connects its own.
              </p>
            </div>
            <HeroProductPanel />
          </div>
        </section>

        <section className="lux-problem" aria-labelledby="lux-problem-title">
          <div className="lux-content">
            <header className="lux-section-head" data-reveal>
              <p className="lux-eyebrow">The problem</p>
              <h2 id="lux-problem-title">Your season lives in three places that forget.</h2>
              <p>Said plainly, because every mentor already knows it.</p>
            </header>
            <ul className="lux-feature-grid" data-reveal>
              {problems.map((item) => (
                <li key={item.title}>
                  <span className="lux-card-icon">
                    <MIcon name={item.icon} />
                  </span>
                  <strong>{item.title}</strong>
                  <span>{item.copy}</span>
                </li>
              ))}
            </ul>
            <p className="lux-closer" data-reveal>
              None of that is fixed by trying harder. It is what happens when the record of a season has no home — and
              when the tool that finally does the work does it silently, so nobody learns anything from it either.
            </p>
          </div>
        </section>

        <section className="lux-loop" id="how-it-works" aria-labelledby="lux-loop-title">
          <div className="lux-content">
            <header className="lux-section-head" data-reveal>
              <p className="lux-eyebrow">How it works</p>
              <h2 id="lux-loop-title">Three steps to a season that remembers.</h2>
              <p>Provision once, work the season in one place, and let the students end it able to do the work.</p>
            </header>
            <ol className="lux-loop-steps" data-reveal>
              {steps.map((item) => (
                <li key={item.step}>
                  <b aria-hidden="true">{item.step}</b>
                  <strong>{item.title}</strong>
                  <span>{item.copy}</span>
                </li>
              ))}
            </ol>
            <div className="mk-rules" data-reveal>
              <h3>The rules the agent plays by</h3>
              <ul className="lux-rules">
                {rules.map((rule) => (
                  <li key={rule.lead}>
                    <b>{rule.lead}</b> {rule.copy}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </section>

        <section className="lux-runs" aria-labelledby="lux-runs-title">
          <div className="lux-content">
            <header className="lux-section-head" data-reveal>
              <p className="lux-eyebrow">One workspace</p>
              <h2 id="lux-runs-title">One app, not twenty tabs.</h2>
              <p>Six hubs under one login, sharing one event context and one set of numbers.</p>
            </header>
            <ul className="mk-pillars" data-reveal>
              {pillars.map((item) => (
                <li key={item.title}>
                  <span className="lux-card-icon">
                    <MIcon name={item.icon} />
                  </span>
                  <span className="mk-tag">{item.hub}</span>
                  <strong>{item.title}</strong>
                  <span className="mk-pillar-copy">{item.copy}</span>
                </li>
              ))}
            </ul>
            <div className="lux-callout" data-reveal>
              <p>
                <b>What one workspace makes possible.</b> Because it is a single tenant rather than six tools, a
                question can cross features nothing else can join:
              </p>
              <p>
                <q>
                  This subsystem is behind schedule, the part is stuck at QC, the replacement bearing was never ordered,
                  and the two students who know the assembly haven’t attended in three weeks.
                </q>
              </p>
            </div>
          </div>
        </section>

        <section className="lux-fit" aria-labelledby="lux-trust-title">
          <div className="lux-content">
            <header className="lux-section-head" data-reveal>
              <p className="lux-eyebrow">Trust</p>
              <h2 id="lux-trust-title">What we do — and don’t do — with your team’s data.</h2>
              <p>Six commitments a mentor or a district administrator can check against the product itself.</p>
            </header>
            <ul className="lux-feature-grid" data-reveal>
              {trust.map((item) => (
                <li key={item.title}>
                  <span className="lux-card-icon">
                    <MIcon name={item.icon} />
                  </span>
                  <strong>{item.title}</strong>
                  <span>{item.copy}</span>
                </li>
              ))}
            </ul>
            <p className="mk-footnote" data-reveal>
              <b>And the one thing we do do.</b> Prompts, the context sent with them, model responses and tool traces
              from Vantage&rsquo;s AI features may be used by us to train and evaluate our own in-house models. That is
              written plainly in the <a href="/privacy">Privacy Policy</a> — read it before your team decides.
            </p>
          </div>
        </section>

        <PricingStrip headingId="lux-pricing-title" />

        <FAQ />

        <section className="lux-waitlist" id="waitlist">
          <div data-reveal>
            <p className="lux-eyebrow">Closed beta</p>
            <h2>Request access.</h2>
            <p>
              Vantage is invite-only while it is in closed beta. A platform admin provisions each team with a verified
              owner, and owners and admins invite exact emails from there. Joining the waitlist does not create an
              account — we email when your team is provisioned.
            </p>
          </div>
          <div id="hero-waitlist" data-reveal>
            <WaitlistForm idPrefix="hero" />
          </div>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
