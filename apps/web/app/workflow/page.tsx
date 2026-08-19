import type { Metadata } from "next";
import { SiteFooter, SiteHeader } from "../../components/marketing/site-header";
import { marketingPageMetadata } from "../../lib/marketing/seo";

export const metadata: Metadata = marketingPageMetadata({
  title: "How it works — Vantage",
  description: "Scout at the venue, sync when you have signal, then pick alliances from your own notes.",
  path: "/workflow",
});

const stages = [
  ["1", "Scout", "Match and pit forms stay on the tablet when venue Wi-Fi drops."],
  ["2", "Sync", "Entries join your team workspace when the network comes back."],
  ["3", "Decide", "Strategy and picks use The Blue Alliance plus your scout notes — not sample odds."],
  ["4", "Run the day", "Next match and pit cues sit in the same Competition workspace."],
] as const;

export default function WorkflowPage() {
  return (
    <div className="marketing-site marketing-lux">
      <SiteHeader />
      <main className="route-page">
        <header className="lux-route-hero">
          <h1>How it works.</h1>
          <p>One team. One event. Scouting feeds the rest of the day.</p>
          <div className="actions">
            <a className="button primary" href="/#waitlist">
              Join the waitlist
            </a>
            <a className="button secondary" href="/features">
              See the product
            </a>
          </div>
        </header>

        <section className="flow-map lux-content" aria-label="How Vantage works">
          {stages.map(([id, title, detail], index) => (
            <article key={id}>
              <div>
                <b>{id}</b>
                {index < stages.length - 1 && <i aria-hidden="true" />}
              </div>
              <section>
                <h2>{title}</h2>
                <p>{detail}</p>
              </section>
            </article>
          ))}
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
