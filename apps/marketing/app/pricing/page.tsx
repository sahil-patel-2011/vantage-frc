const individualPlans = [
  {
    name: "Free",
    price: "$0",
    signal: "BYO AI KEY",
    features: ["Offline scouting, TBA/Statbotics lookup, CSV, and team basics", "Bring a supported API key or local model", "Standard prediction explanation; limited context and agent steps", "CAD brief, deterministic mock/local connector setup, and basic code Q&A"],
  },
  {
    name: "Individual Pro",
    price: "$30",
    signal: "ONE USER / PRIVATE",
    features: ["15 included Vantage Credits per paid period", "Private workspace and personal AI jobs only", "Larger personal context, agent, CAD, and code limits", "Does not unlock team-wide premium features"],
  },
  {
    name: "Individual Max",
    price: "$50",
    signal: "ONE USER / HIGHER",
    features: ["30 included Vantage Credits per paid period", "Private workspace and personal AI jobs only", "Higher personal context, agent, CAD, and code limits", "Does not fund shared automations by default"],
  },
];
const teamPlans=[{name:"Team Pro",price:"$100",signal:"WHOLE ORGANIZATION",features:["60 pooled Vantage Credits per paid period","Premium shared AI and team automations","Shared memory, scheduled research, team CAD/artifacts and TV intelligence","Org budget/member/feature controls"]},{name:"Team Max",price:"$200",signal:"WHOLE ORGANIZATION / MAX",features:["130 pooled Vantage Credits per paid period","Highest team limits, context, priority, and concurrency","Advanced CAD, strategy, code, shared analytics and admin workflows","Not priced per student seat"]}];

export default function PricingPage() {
  return <><header className="nav"><a className="wordmark" href="/"><span>V</span> VANTAGE</a><nav><a href="/#product">Product</a><a href="/#flow">How it works</a><a aria-current="page" href="/pricing">Pricing</a></nav><a className="button compact" href="/#waitlist">Join waitlist</a></header>
    <main className="pricing-page">
      <section className="pricing-hero"><span className="section-id">PRICING / INDIVIDUAL OR TEAM</span><h1>Fund private work or the whole team—deliberately.</h1><p>Individual plans cover one user's private jobs. Team plans cover the organization and shared automations. No per-seat student pricing and no surprise charges.</p></section>
      <section className="pricing-toggle" aria-label="Pricing groups"><a href="#individual">Individual</a><a href="#team">Team</a></section>
      <section id="individual"><span className="section-id">INDIVIDUAL / PRIVATE WORKSPACE</span><div className="pricing-grid">{individualPlans.map((plan) => <article key={plan.name}><span>{plan.signal}</span><h2>{plan.name}</h2><div><strong>{plan.price}</strong><small>/ month</small></div><ul>{plan.features.map((feature) => <li key={feature}>{feature}</li>)}</ul><a className="button primary" href="/#waitlist">Join early access</a></article>)}</div></section>
      <section id="team"><span className="section-id">TEAM / ENTIRE ORGANIZATION</span><div className="pricing-grid">{teamPlans.map((plan) => <article key={plan.name}><span>{plan.signal}</span><h2>{plan.name}</h2><div><strong>{plan.price}</strong><small>/ month</small></div><ul>{plan.features.map((feature) => <li key={feature}>{feature}</li>)}</ul><a className="button primary" href="/#waitlist">Join early access</a></article>)}</div></section>
      <section className="payg"><div><span className="section-id">VANTAGE CREDITS</span><h2>Service credits, not API dollars</h2></div><div><p>Included credits reset and expire at the end of their paid period. Purchased/gifted credits are separate, non-withdrawable service credits. Launch routing debit uses a configurable 1.25× provider-cost multiplier for routing, tools, context processing, and support: for example, $1 provider cost may debit 1.25 credits under the published model table.</p><p>Purchased $10 = 10 Vantage Credits. Prepaid stopping at zero is the default. PAYG requires explicit enrollment, a payment method, hard monthly cap, and warnings. BYOK/local cost does not consume credits, but plan entitlements and all org limits still apply.</p><p>Org admins may explicitly allow a member's individual plan to fund an authorized private run against org data. The output stays org-scoped and cannot bypass org policy. Shared automations always use the team billing account.</p><p className="pricing-note">Prices, credits, limits, multiplier, and future effective dates are versioned catalog configuration. Existing paid periods keep their purchased terms until renewal.</p></div></section>
    </main><footer><a className="wordmark" href="/"><span>V</span> VANTAGE</a><p>Competition telemetry for the whole season.</p><nav><a href="/privacy">Privacy</a><a href="/terms">Terms</a></nav></footer></>;
}
