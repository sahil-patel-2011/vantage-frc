import type { Metadata } from "next";
import { WaitlistSection } from "../../components/marketing/waitlist-section";
import { MarketingRouteActions, SiteFooter, SiteHeader } from "../../components/marketing/site-header";
import { marketingPageMetadata } from "../../lib/marketing/seo";

export const metadata: Metadata = marketingPageMetadata({
  title: "Cost — Vantage",
  description:
    "Vantage is free for FRC teams. Connect personal Codex or use a personal or team AI provider key. External provider charges are separate.",
  path: "/pricing",
});

/**
 * What Vantage costs: nothing, right now. There are no plans. The page answers the two questions a
 * mentor actually has (is it free, and what about AI) and gets out of the way.
 */
const STEPS = [
  {
    title: "Get a key",
    body: "OpenAI, Anthropic, Google AI Studio or OpenRouter, or any service that works like OpenAI's, such as Groq. Google AI Studio, OpenRouter and Groq have free tiers.",
  },
  {
    title: "Paste it once",
    body: "An owner or admin adds it under AI keys. Keys are encrypted and never shown again, not even to you.",
  },
  {
    title: "Or connect personal Codex",
    body: "Pair your own computer from Personal connections. Requests use your Codex account on that device; credentials stay there. Your provider's subscription, usage limits and charges apply separately.",
  },
  {
    title: "Set a limit",
    body: "The provider bills the account that supplies the key. Use provider spending controls and Vantage's per-member limits for API requests.",
  },
] as const;

const QUESTIONS = [
  {
    q: "Is anything held back?",
    a: "No. Scouting, strategy, pit, the build, the budget, chat and the calendar are all included for every team.",
  },
  {
    q: "Do we have to use AI?",
    a: "No. Vantage's team tools work without AI. If you want an assistant, connect your own Codex account or add a provider key.",
  },
  {
    q: "Can students use their own key?",
    a: "Yes. A member can add a personal key that only their own requests use.",
  },
  {
    q: "Will it stay free?",
    a: "Every feature is free today and there is nothing to buy. If a paid extra is ever added, owners hear it by email first, and nothing is ever charged unless an owner chooses it.",
  },
] as const;

export default function PricingPage() {
  return (
    <div className="marketing-site marketing-lux">
      <SiteHeader />
      <main className="pricing-page">
        <section className="lux-route-hero pricing-hero">
          <p className="lux-kicker">What it costs</p>
          <h1>Free for every team. Connect your own AI.</h1>
          <p>
            Vantage has no subscription charge and requires no card. Optional AI uses a personal or team provider key,
            or your own paired Codex account. External providers set their own prices and usage limits.
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

        {/* The home page's section: its heading follows the form, so after joining it no longer
            says "Join the waitlist." above "You're on the list." */}
        <WaitlistSection />
      </main>
      <SiteFooter />
    </div>
  );
}
