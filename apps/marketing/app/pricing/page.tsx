const plans = [
  {
    name: "Free",
    price: "$0",
    signal: "BYO AI KEY",
    features: ["Bring a supported provider API key", "Encrypted key storage", "Usage visibility and model ledger", "Core team workflows"],
  },
  {
    name: "Vantage Pro",
    price: "$20",
    signal: "MANAGED MODELS",
    features: ["Configured included AI allowance", "Enhanced reasoning and model routing", "Unified strategy, prediction, CAD, coding, scouting, and research context", "Hard usage controls"],
  },
  {
    name: "Vantage Max",
    price: "$50",
    signal: "MORE HEADROOM",
    features: ["Materially higher configured AI allowance", "Expanded managed features", "Automatic eligible-model selection", "Team-level usage oversight"],
  },
];

export default function PricingPage() {
  return <><header className="nav"><a className="wordmark" href="/"><span>V</span> VANTAGE</a><nav><a href="/#product">Product</a><a href="/#flow">How it works</a><a aria-current="page" href="/pricing">Pricing</a></nav><a className="button compact" href="/#waitlist">Join waitlist</a></header>
    <main className="pricing-page">
      <section className="pricing-hero"><span className="section-id">PRICING / CONTROLLED AI</span><h1>Choose headroom. Keep control.</h1><p>Every paid model call stays behind visible allowances, opt-in overage, spend caps, warnings, and a kill switch. No surprise charges.</p></section>
      <section className="pricing-grid">{plans.map((plan) => <article key={plan.name}><span>{plan.signal}</span><h2>{plan.name}</h2><div><strong>{plan.price}</strong><small>/ month</small></div><ul>{plan.features.map((feature) => <li key={feature}>{feature}</li>)}</ul><a className="button primary" href="/#waitlist">Join early access</a></article>)}</section>
      <section className="payg"><div><span className="section-id">OPTIONAL / OPT-IN</span><h2>Vantage Usage Credits + PAYG</h2></div><div><p>Continue beyond an included allowance only after an owner explicitly enables prepaid credits or Stripe-metered overage.</p><ul><li>Owner-defined spend cap</li><li>Low-balance warning</li><li>Immediate kill switch</li><li>Transparent provider/model cost ledger</li><li>Fable 5 is always API-rate PAYG on top of a subscription</li></ul><p className="pricing-note">Included allowances, provider rates, and model eligibility are live platform configuration—not fixed marketing promises. They are shown before activation in the product.</p></div></section>
    </main><footer><a className="wordmark" href="/"><span>V</span> VANTAGE</a><p>Competition telemetry for the whole season.</p><nav><a href="/privacy">Privacy</a><a href="/terms">Terms</a></nav></footer></>;
}
