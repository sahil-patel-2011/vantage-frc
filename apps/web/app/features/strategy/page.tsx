import type { Metadata } from "next";
import { ProductFrame } from "../../../components/marketing/app-frames";
import { MarketingRouteActions, SiteFooter, SiteHeader } from "../../../components/marketing/site-header";
import { marketingPageMetadata } from "../../../lib/marketing/seo";

export const metadata: Metadata = marketingPageMetadata({
  title: "Strategy & Ask AI — Vantage",
  description:
    "Match plans, a shared pick list for alliance selection, and Ask AI, built from public match data and your own scouting.",
  path: "/features/strategy",
});

const assistantJobs = [
  { id: "01", title: "Strategy & playbooks", copy: "Drive-team briefings from your scouting and the public match record." },
  { id: "02", title: "Matchups & picks", copy: "A shared pick list and a pick timer, for the event you are at." },
  { id: "03", title: "Opponent history", copy: "How teams tend to auto, cycle, defend, climb." },
  { id: "04", title: "Robot capabilities", copy: "Pit notes beside public metrics—empty until scouted." },
] as const;

const scoutFeeds = [
  { title: "Competition · Strategy", copy: "Playbooks from your scouting plus public facts — empty until someone scouts." },
  { title: "Alliance selection", copy: "A shared board for all eight alliances, with your scouting behind every pick and a flag when it disagrees with the official results." },
  { title: "Settle close picks", copy: "Compare two robots head to head, with a timer for the pick itself." },
  { title: "Drive-team tags", copy: "Defense, climb, partner-fit labels on event robots — blank until applied." },
  { title: "Event day and My Day", copy: "Your next match, the pit queue and your bumper colour, in one place." },
  { title: "Ask AI", copy: "Answers show where they came from: public match data, ratings or your scouts. Missing numbers stay blank." },
] as const;

export default function StrategyFeaturePage() {
  return (
    <div className="marketing-site marketing-lux">
      <SiteHeader />
      <main className="route-page">
        <header className="lux-route-hero has-visual">
          <p className="lux-kicker">Strategy</p>
          <h1>Strategy you can inspect.</h1>
          <p>
            Match plans, the alliance selection board, a pick timer and Ask AI, built from public match data and
            what your scouts record. Nothing is filled in until that data exists.
          </p>
          <MarketingRouteActions
            companion={{ href: "#frc-assistant", label: "See the assistant", variant: "secondary" }}
          />
          {/* The right half of the first screen was empty on a laptop: show the product there. */}
          <div className="lux-route-hero-visual" aria-hidden="true">
            <ProductFrame id="predict" />
          </div>
        </header>

        <section className="assistant-story" id="frc-assistant" aria-labelledby="assistant-title">
          <div className="lux-content">
            <header>
              <span className="section-id">ASK AI</span>
              <h2 id="assistant-title">Ask about your event. See where every answer came from.</h2>
              <p>Built from public match data and your scouts. An event with no data says so.</p>
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
              <h2 id="scout-feed-title">Everything here uses the same scouting data.</h2>
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
          <MarketingRouteActions
            className="pricing-preview-actions"
            guestLabel="Join the waitlist"
            companion={{ href: "/features", label: "All features", variant: "secondary" }}
          />
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
