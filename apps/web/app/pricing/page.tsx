import type { Metadata } from "next";
import { WaitlistSection } from "../../components/marketing/waitlist-section";
import { MarketingPageActions, SiteFooter, SiteHeader } from "../../components/marketing/site-header";
import { ScrollReveal } from "../../components/marketing/scroll-reveal";
import { marketingPageMetadata } from "../../lib/marketing/seo";

export const metadata: Metadata = marketingPageMetadata({
  title: "Cost — Vantage",
  description:
    "Vantage is free for FRC teams: no subscription, no card, every feature included. AI is optional and runs on your own provider key, Codex or Claude Code. External provider charges are separate.",
  path: "/pricing",
});

/**
 * What Vantage costs: nothing, right now. There are no plans. The page answers the two questions a
 * mentor actually has (is it free, and what about AI) and gets out of the way.
 */
const INCLUDED = [
  "Pit and match scouting, offline",
  "Pick lists, match plans and the pit",
  "Tasks, the calendar, hours and chat",
  "Money, sponsors and grants",
  "Code reviews, Robot Blueprint and CAD",
  "Guided learning and team lessons",
] as const;

const STEPS = [
  {
    title: "Pick a provider",
    body: "OpenAI, Anthropic, Google AI Studio or OpenRouter, or any service that works like OpenAI's, such as Groq. Google AI Studio, OpenRouter and Groq have free tiers.",
  },
  {
    title: "Add the key once",
    body: "An owner or admin adds it under AI keys. Keys are encrypted and never shown again, not even to you.",
  },
  {
    title: "Or pair your own account",
    body: "Pair your own Codex or Claude Code on your computer from Personal connections. Requests use your account there, its sign-in stays on that computer, and your plan's limits apply.",
  },
  {
    title: "Set a limit",
    body: "The provider bills whoever supplies the key. Use the provider's spending controls and Vantage's per-member limits for API requests.",
  },
] as const;

const QUESTIONS = [
  {
    q: "Is anything held back?",
    a: "No. Scouting, strategy, the pit, the build, the budget, chat, the calendar and learning are included for every team.",
  },
  {
    q: "Do we have to use AI?",
    a: "No. Vantage's team tools work without AI. If you want an assistant, pair your own Codex or Claude Code, or add a provider key.",
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
      <main>
        <section className="mx-page-hero" aria-labelledby="cost-title">
          <div className="mx-wrap">
            <p className="mx-eyebrow">Cost</p>
            <h1 className="mx-display" id="cost-title">
              Free for every team.
            </h1>
            <p className="mx-lead">
              No subscription and no card. Every feature is included. AI is optional, and runs on your own provider
              key or your own Codex or Claude Code; those providers set their own prices.
            </p>
            {/* Guests: "Join the waitlist". Members: "Open your team". */}
            <MarketingPageActions
              guestLabel="Join the waitlist"
              companion={{ href: "#ai-keys", label: "How AI keys work" }}
            />
          </div>
        </section>

        <section className="mx-section is-flush-top" aria-labelledby="included-title">
          <div className="mx-wrap">
            <div className="mx-price-card">
              <div>
                <p className="mx-price-figure">
                  <b>$0</b>
                  <span>per team</span>
                </p>
                <h2 className="mx-h3" id="included-title">
                  Everything, for every team.
                </h2>
              </div>
              <ul className="mx-included">
                {INCLUDED.map((item) => (
                  <li key={item}>
                    <i className="mx-check" aria-hidden="true" />
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </section>

        <section className="mx-section mx-band" id="ai-keys" aria-labelledby="ai-keys-title">
          <div className="mx-wrap">
            <header className="mx-head">
              <p className="mx-eyebrow">Optional AI</p>
              <h2 className="mx-h2" id="ai-keys-title">
                How AI keys work.
              </h2>
              <p className="mx-lead">
                Bring a key or your own account. The provider bills whoever supplies it, so you see the bill and set
                the limit.
              </p>
            </header>
            <ol className="mx-steps" data-mx-reveal="">
              {STEPS.map((step) => (
                <li key={step.title}>
                  <strong>{step.title}</strong>
                  <span>{step.body}</span>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section className="mx-section" aria-labelledby="pricing-faq-title">
          <div className="mx-wrap">
            <header className="mx-head">
              <p className="mx-eyebrow">Questions</p>
              <h2 className="mx-h2" id="pricing-faq-title">
                About the cost.
              </h2>
            </header>
            <dl className="mx-qa">
              {QUESTIONS.map((item) => (
                <div key={item.q}>
                  <dt>{item.q}</dt>
                  <dd>{item.a}</dd>
                </div>
              ))}
            </dl>
          </div>
        </section>

        {/* The home page's section: its heading follows the form, so after joining it no longer
            says "Join the waitlist." above "You're on the list." */}
        <WaitlistSection />
      </main>
      <SiteFooter />
      <ScrollReveal />
    </div>
  );
}
