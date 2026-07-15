import type { Metadata } from "next";
import { SiteFooter, SiteHeader } from "../../../components/marketing/site-header";
import { AssistantPreview, StrategyPreview } from "../../../components/marketing/product-demos";

export const metadata: Metadata = {
  title: "FRC Assistant & Strategy — Vantage",
  description:
    "FRC Assistant for competition ops and intel: strategy, matchups, opponent history, robot capabilities, and scouting that feeds predictions, pick lists, and live awareness—with provenance, not vanity stats.",
  alternates: { canonical: "/features/strategy" },
};

const assistantJobs = [
  {
    id: "01",
    title: "Strategy & playbooks",
    copy: "Turn alliance context into inspectable priorities, role plans, and drive-team talk tracks—tied to the factors that produced them.",
  },
  {
    id: "02",
    title: "Matchups & game choices",
    copy: "Ask which alliances, partners, or schedules favor your robot. Answers cite TBA/Statbotics history and your scouted observations—not a black-box scoreboard.",
  },
  {
    id: "03",
    title: "Opponent prediction from history",
    copy: "Surface how teams tend to auto, cycle, defend, or climb based on prior matches and pit notes. Sparse data stays labeled; confidence stays visible.",
  },
  {
    id: "04",
    title: "Robot capability awareness",
    copy: "Capability profiles from pit scouting and observed match play sit next to public metrics so “what can they do?” is evidence-backed, not folklore.",
  },
];

const scoutFeeds = [
  {
    title: "Strategy & what-if",
    copy: "Attributed scout facts weight into win/loss factors. What-if deltas stay separate so guesses never look like observations.",
  },
  {
    title: "Predictions",
    copy: "Weighted-current models combine TBA/Statbotics with your org’s synced scout data, then show intervals, key factors, and caveats.",
  },
  {
    title: "Pick lists",
    copy: "Alliance drafts pull from event-scoped coverage, reliability notes, and capability tags your scouts actually recorded.",
  },
  {
    title: "Live match awareness",
    copy: "Next-match boards and the Assistant read the same event context—schedule, readiness signals, and fresh scout sync—not a siloed chat transcript.",
  },
];

export default function StrategyFeaturePage() {
  return (
    <div className="marketing-site marketing-v2">
      <SiteHeader />
      <main className="route-page">
        <header className="route-hero split-hero">
          <div>
            <span className="section-id">FRC ASSISTANT · STRATEGY · AVAILABLE</span>
            <h1>Competition intel you can inspect—not a vanity dashboard.</h1>
            <p>
              Vantage’s FRC Assistant helps with strategy, matchups, opponent history, and robot capabilities inside your
              team’s active event. Scouting is not a bolt-on spreadsheet: synced observations feed predictions, playbooks,
              pick lists, and live ops with source labels intact.
            </p>
            <div className="route-hero-actions">
              <a className="button primary" href="/signin">
                Sign in to use Strategy &amp; Assistant
              </a>
              <a className="button secondary" href="#frc-assistant">
                How the Assistant works
              </a>
            </div>
          </div>
          <StrategyPreview />
        </header>

        <section className="assistant-story" id="frc-assistant" aria-labelledby="assistant-title">
          <header>
            <span className="section-id">FRC ASSISTANT</span>
            <h2 id="assistant-title">Ask anything competition-ops. Answers keep their sources.</h2>
            <p>
              Confident where evidence exists; honest where it doesn’t. The Assistant leans on season history, robot
              capabilities, and your scouted facts—then keeps official metrics, observations, research, and assumptions
              distinct so AI never invents a win percentage when the event isn’t wired up.
            </p>
          </header>
          <div className="assistant-story-grid">
            <div className="assistant-job-grid">
              {assistantJobs.map((job) => (
                <article key={job.id}>
                  <b>{job.id}</b>
                  <h3>{job.title}</h3>
                  <p>{job.copy}</p>
                </article>
              ))}
            </div>
            <AssistantPreview />
          </div>
        </section>

        <section className="scout-integration" aria-labelledby="scout-integration-title">
          <header>
            <span className="section-id">SCOUTING ↔ EVERYTHING ELSE</span>
            <h2 id="scout-integration-title">Scout once. The rest of the system stays current.</h2>
            <p>
              Offline match and pit forms sync into organization-scoped facts. Those facts don’t sit in a dead archive—they
              inform Strategy, the Assistant, predictions, pick lists, and day-of awareness as one connected loop.
            </p>
          </header>
          <div className="scout-feed-grid">
            {scoutFeeds.map((item) => (
              <article key={item.title}>
                <h3>{item.title}</h3>
                <p>{item.copy}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="detail-proof-grid" aria-label="Strategy engine details">
          <article>
            <b>01</b>
            <h2>Prediction with limits</h2>
            <p>
              Red/blue probabilities, effective sample size, confidence interval, model version, key factors, and
              sparse-data caveats—built from TBA/Statbotics plus scout facts when available.
            </p>
          </article>
          <article>
            <b>02</b>
            <h2>Explicit what-if</h2>
            <p>
              Point deltas are recorded as assumptions so a changed probability never masquerades as an observed result.
            </p>
          </article>
          <article>
            <b>03</b>
            <h2>Playbook + debrief</h2>
            <p>
              Alliance priorities, risks, role checkpoints, and post-match prompts stay linked to the factors that
              produced them.
            </p>
          </article>
        </section>

        <section className="technical-note">
          <span className="section-id">PROVENANCE</span>
          <h2>No DEMO fake dashboards as live product data.</h2>
          <p>
            Marketing previews on this page are labeled demo fixtures. Signed-in Strategy and the Assistant stay empty or
            limited until workspace, event, and real metrics/scout inputs exist. Official results always outrank
            estimates.
          </p>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
