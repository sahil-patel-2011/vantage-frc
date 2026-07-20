import type { Metadata } from "next";
import { SiteFooter, SiteHeader } from "../../../components/marketing/site-header";

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
    copy: "Models combine TBA/Statbotics with your org’s synced scout data, then show intervals, key factors, and caveats.",
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
    <div className="marketing-site marketing-v2 marketing-dense marketing-quiet">
      <SiteHeader />
      <main className="route-page">
        <header className="route-hero brand-route-hero">
          <p className="brand-hero-wordmark route-wordmark">Vantage</p>
          <span className="section-id">FRC ASSISTANT · STRATEGY</span>
          <h1>Competition intel you can inspect—not a vanity dashboard.</h1>
          <p>
            Strategy, matchups, opponent history, and robot capabilities inside your team’s active event. Synced
            scouting feeds predictions and pick lists with source labels intact—empty until real data exists.
          </p>
          <div className="route-hero-actions">
            <a className="button primary" href="/signin">
              Sign in to use Strategy
            </a>
            <a className="button secondary" href="#frc-assistant">
              How the Assistant works
            </a>
          </div>
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
          </div>
        </section>

        <section className="supporting-gallery" aria-labelledby="scout-feed-title">
          <header>
            <span className="section-id">SCOUTING FEEDS</span>
            <h2 id="scout-feed-title">Observations that travel with the season.</h2>
          </header>
          <div className="supporting-status-grid">
            {scoutFeeds.map((item) => (
              <article key={item.title}>
                <h3>{item.title}</h3>
                <p>{item.copy}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="pricing-preview">
          <div>
            <span className="section-id">NEXT</span>
            <h2>See the rest of the product, or join the waitlist.</h2>
          </div>
          <div className="pricing-preview-actions">
            <a className="button primary" href="/#waitlist">
              Join waitlist
            </a>
            <a className="button secondary" href="/features">
              Product overview
            </a>
          </div>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
