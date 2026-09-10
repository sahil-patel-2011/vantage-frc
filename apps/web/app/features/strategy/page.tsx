import type { Metadata } from "next";
import { SiteFooter, SiteHeader } from "../../../components/marketing/site-header";
import { marketingPageMetadata } from "../../../lib/marketing/seo";

export const metadata: Metadata = marketingPageMetadata({
  title: "Strategy & FRC Assistant — Vantage",
  description:
    "Competition Strategy, Alliance Selection Desk, Pick clock, and FRC Assistant—sourced from TBA and your scouting.",
  path: "/features/strategy",
});

const assistantJobs = [
  { id: "01", title: "Strategy & playbooks", copy: "Drive-team briefs from real scout + TBA facts." },
  { id: "02", title: "Matchups & picks", copy: "Alliance Selection Desk and Pick clock, for the event you are at." },
  { id: "03", title: "Opponent history", copy: "How teams tend to auto, cycle, defend, climb." },
  { id: "04", title: "Robot capabilities", copy: "Pit notes beside public metrics—empty until scouted." },
] as const;

const scoutFeeds = [
  { title: "Competition · Strategy", copy: "Playbooks from your scouting plus public facts — empty until someone scouts." },
  { title: "Alliance Selection Desk", copy: "Shared 8-alliance board with scout evidence attached. TBA conflict flags when cache exists." },
  { title: "Pick clock & pairwise", copy: "Timed picks plus qualitative A-beats-B ranking. Empty until real taps." },
  { title: "Drive-team tags", copy: "Defense, climb, partner-fit labels on event robots — blank until applied." },
  { title: "Command / My Day", copy: "Same event context: next match, pit queue, bumper color from TBA lists." },
  { title: "FRC Assistant", copy: "Answers cite TBA, Statbotics cache, and scout notes. No invented win %." },
] as const;

export default function StrategyFeaturePage() {
  return (
    <div className="marketing-site marketing-lux">
      <SiteHeader />
      <main className="route-page">
        <header className="lux-route-hero">
          <p className="lux-kicker">Strategy</p>
          <h1>Strategy you can inspect.</h1>
          <p>
            Competition Strategy, Alliance Selection Desk, pick clock, pairwise ranking, and FRC Assistant — sourced
            from The Blue Alliance cache and your scout entries. Empty until those exist.
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
              <h2 id="scout-feed-title">Same scout feed across hubs.</h2>
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
