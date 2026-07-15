import type { Metadata } from "next";
import { SiteFooter, SiteHeader } from "../../components/marketing/site-header";

export const metadata: Metadata = {
  title: "Pricing — Vantage",
  description: "Individual and team Vantage plans, included service credits, and explicit overage controls.",
  alternates: { canonical: "/pricing" },
};

const individualPlans = [
  { name: "Free", price: "$0", signal: "COMPLETE CORE + BYOK / LOCAL", features: ["Complete non-AI core: offline scouting, cached TBA/Statbotics, manual strategy and pick lists, exports, and team operations", "Bring a supported API key or pair a local OpenAI-compatible relay", "Limited sponsored AI may appear only when a commercially approved provider is explicitly funded and enabled; launch default is unavailable", "No silent paid-model routing or surprise provider charges"] },
  { name: "Individual Pro", price: "$30", signal: "ONE USER / PRIVATE", features: ["15 included Vantage Credits per paid period", "Private workspace and personal AI jobs only", "Larger personal context, agent, CAD, and code limits", "Does not unlock team-wide premium features"] },
  { name: "Individual Max", price: "$50", signal: "ONE USER / HIGHER", features: ["30 included Vantage Credits per paid period", "Private workspace and personal AI jobs only", "Higher personal context, agent, CAD, and code limits", "Does not fund shared automations by default"] },
];
const teamPlans = [
  { name: "Team Pro", price: "$100", signal: "WHOLE ORGANIZATION", features: ["60 pooled Vantage Credits per paid period", "Premium shared AI and team automations", "Shared memory, scheduled research, team CAD/artifacts and TV intelligence", "Org budget/member/feature controls"] },
  { name: "Team Max", price: "$200", signal: "WHOLE ORGANIZATION / MAX", features: ["130 pooled Vantage Credits per paid period", "Highest team limits, context, priority, and concurrency", "Advanced CAD, strategy, code, shared analytics and admin workflows", "Not priced per student seat"] },
];

export default function PricingPage() {
  return <div className="marketing-site"><SiteHeader />
    <main className="pricing-page">
      <section className="pricing-hero"><span className="section-id">PRICING / INDIVIDUAL OR TEAM</span><h1>Fund private work or the whole team—deliberately.</h1><p>Free keeps the competition core useful with BYOK/local AI. Paid plans add managed recommended models, routing and failover, larger context and memory, more tool steps, scheduled agents, advanced CAD/strategy/coding, and support. No per-seat student pricing and no surprise charges.</p></section>
      <section className="pricing-toggle" aria-label="Pricing groups"><a href="#individual">Individual</a><a href="#team">Team</a></section>
      <section id="individual"><span className="section-id">INDIVIDUAL / PRIVATE WORKSPACE</span><div className="pricing-grid">{individualPlans.map((plan) => <article key={plan.name}><span>{plan.signal}</span><h2>{plan.name}</h2><div><strong>{plan.price}</strong><small>/ month</small></div><ul>{plan.features.map((feature) => <li key={feature}>{feature}</li>)}</ul><a className="button primary" href="/#waitlist">Join early access</a></article>)}</div></section>
      <section id="team"><span className="section-id">TEAM / ENTIRE ORGANIZATION</span><div className="pricing-grid">{teamPlans.map((plan) => <article key={plan.name}><span>{plan.signal}</span><h2>{plan.name}</h2><div><strong>{plan.price}</strong><small>/ month</small></div><ul>{plan.features.map((feature) => <li key={feature}>{feature}</li>)}</ul><a className="button primary" href="/#waitlist">Join early access</a></article>)}</div></section>
      <section className="payg"><div><span className="section-id">VANTAGE CREDITS</span><h2>Service credits, not API dollars</h2></div><div><p>Included credits reset and expire at the end of their paid period. Purchased/gifted credits are separate, non-withdrawable service credits. Launch routing debit uses a configurable 1.25× provider-cost multiplier for routing, tools, context processing, and support: for example, $1 provider cost may debit 1.25 credits under the published model table.</p><p>Purchased $10 = 10 Vantage Credits. Prepaid stopping at zero is the default. PAYG requires explicit enrollment, a payment method, hard monthly cap, and warnings. BYOK/local cost does not consume credits, but plan entitlements and all org limits still apply.</p><p>Sponsored free AI, when available, is clearly labeled, low priority, capped per user/org/IP and never falls through to a paid model. Exhaustion offers BYOK, local relay, or upgrade.</p><p>Org admins may explicitly allow a member&apos;s individual plan to fund an authorized private run against org data. The output stays org-scoped and cannot bypass org policy. Shared automations always use the team billing account.</p><p className="pricing-note">Prices, credits, limits, multiplier, and future effective dates are versioned catalog configuration. Existing paid periods keep their purchased terms until renewal.</p></div></section>
    </main><SiteFooter /></div>;
}
