import type { Metadata } from "next";
import { SiteFooter, SiteHeader } from "../../../components/marketing/site-header";

export const metadata: Metadata = {
  title: "FRC Assistant & Strategy — Vantage",
  description:
    "FRC Assistant, Soft-UI Strategy, Alliance Selection Desk, and Pick clock—sourced from TBA and your scouting, never DEMO win rates.",
  alternates: { canonical: "/features/strategy" },
};

const assistantJobs = [
  { id: "01", title: "Strategy & playbooks", copy: "Drive-team briefs from real scout + TBA facts." },
  { id: "02", title: "Matchups & picks", copy: "Alliance Selection Desk and Pick clock, event-scoped." },
  { id: "03", title: "Opponent history", copy: "How teams tend to auto, cycle, defend, climb." },
  { id: "04", title: "Robot capabilities", copy: "Pit notes beside public metrics—empty until scouted." },
] as const;

const scoutFeeds = [
  { title: "Strategy Soft-UI", copy: "Win/loss factors from attributed scout facts." },
  { title: "Pick desk", copy: "Shared alliance board with scout evidence attached." },
  { title: "Event Day", copy: "Same event context on Command and My Day." },
  { title: "FRC Assistant", copy: "Answers cite sources; no invented win %." },
] as const;

export default function StrategyFeaturePage() {
  return (
    <div className="marketing-site marketing-lux">
      <SiteHeader />
      <main className="route-page">
        <header className="lux-route-hero">
          <p className="lux-wordmark lux-wordmark-sm">Vantage</p>
          <h1>Strategy you can inspect.</h1>
          <p>
            Soft-UI Strategy, Alliance Selection Desk, Pick clock, and FRC Assistant—sourced facts only.
          </p>
          <div className="actions">
            <a className="button primary" href="/#waitlist">
              Join the waitlist
            </a>
            <a className="button secondary" href="#frc-assistant">
              FRC Assistant
            </a>
          </div>
        </header>

        <section className="assistant-story" id="frc-assistant" aria-labelledby="assistant-title">
          <div className="lux-content">
            <header>
              <span className="section-id">FRC ASSISTANT</span>
              <h2 id="assistant-title">Ask competition-ops. Keep the sources.</h2>
              <p>Grounded in TBA, Statbotics, and your scouts. Empty events stay empty.</p>
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
          </div>
        </section>

        <section className="supporting-gallery" aria-labelledby="scout-feed-title">
          <div className="lux-content">
            <header>
              <span className="section-id">WHERE IT SHOWS UP</span>
              <h2 id="scout-feed-title">Same scout feed across Soft-UI.</h2>
            </header>
            <div className="supporting-status-grid">
              {scoutFeeds.map((item) => (
                <article key={item.title}>
                  <h3>{item.title}</h3>
                  <p>{item.copy}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="lux-pricing">
          <div>
            <h2>Related.</h2>
            <p>
              <a href="/features/cad">CAD agent</a> · <a href="/features/code">Code Coach</a> ·{" "}
              <a href="/workflow">How it works</a>
            </p>
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
