import type { Metadata } from "next";
import { WaitlistForm } from "../../components/marketing/waitlist-form";
import { MarketingInvitedNote, MarketingRouteActions, SiteFooter, SiteHeader } from "../../components/marketing/site-header";
import { marketingPageMetadata } from "../../lib/marketing/seo";

export const metadata: Metadata = marketingPageMetadata({
  title: "Free — Vantage",
  description:
    "Vantage is free for every FRC team, with every feature included. AI runs on your team's own key, a free key, or a model on a shop computer. Access is invite-only while we bring teams on.",
  path: "/pricing",
});

/**
 * What Vantage costs: nothing, right now. There are no plans. The page answers the two questions a
 * mentor actually has (is it free, and what about AI) and gets out of the way.
 */
const STEPS = [
  {
    title: "Get a key",
    body: "Any of OpenAI, Anthropic, Google AI Studio or OpenRouter. Google AI Studio, OpenRouter and Groq have free tiers.",
  },
  {
    title: "Paste it once",
    body: "An owner or admin adds it under AI keys. Keys are encrypted and never shown again, not even to you.",
  },
  {
    title: "Set a limit",
    body: "The provider bills your team directly. Set a monthly cap there, and a per-member cap in Vantage.",
  },
] as const;

const QUESTIONS = [
  {
    q: "Is anything held back?",
    a: "No. Scouting, strategy, pit, the build, the budget, chat and the calendar are all included for every team.",
  },
  {
    q: "Do we have to use AI?",
    a: "No. Everything except the AI assistants works without a key. Add one whenever you want.",
  },
  {
    q: "Can students use their own key?",
    a: "Yes. A member can add a personal key that only their own requests use.",
  },
  {
    q: "Will it stay free?",
    a: "It is free while we bring teams on one at a time. If that ever changes you will hear it by email first, well before anything is charged, and nothing is ever charged without an owner choosing it.",
  },
] as const;

export default function PricingPage() {
  return (
    <div className="marketing-site marketing-lux">
      <SiteHeader />
      <main className="pricing-page">
        <section className="lux-route-hero pricing-hero">
          <p className="lux-kicker">What it costs</p>
          <h1>Free for every team. Bring your own AI key.</h1>
          <p>
            Every feature is included, with no plans and no card. The only thing that can cost money is AI, and that runs
            on your team&rsquo;s own key, so you see the bill and you set the limit.
          </p>
          <MarketingRouteActions companion={{ href: "#ai-keys", label: "How AI keys work" }} />
        </section>

        <section className="payg" id="ai-keys">
          <div>
            <h2>How AI keys work</h2>
          </div>
          <ol className="pricing-steps">
            {STEPS.map((step) => (
              <li key={step.title}>
                <strong>{step.title}</strong>
                <span>{step.body}</span>
              </li>
            ))}
          </ol>
        </section>

        <section className="payg pricing-faq" aria-labelledby="pricing-faq-title">
          <div>
            <h2 id="pricing-faq-title">Questions</h2>
          </div>
          <dl>
            {QUESTIONS.map((item) => (
              <div key={item.q}>
                <dt>{item.q}</dt>
                <dd>{item.a}</dd>
              </div>
            ))}
          </dl>
        </section>

        <section className="lux-waitlist pricing-waitlist" id="waitlist">
          <div>
            <h2>Join the waitlist.</h2>
            <MarketingInvitedNote lead="Invite-only while we bring teams on. We email you when your team is set up." className="" />
          </div>
          <WaitlistForm idPrefix="pricing" />
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
