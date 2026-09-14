import type { ReactNode } from "react";
import {
  PRICING_CATALOG,
  TEAM_TRIAL_DAYS,
  byokEveryPlanCopy,
  everyPlanValueLine,
  formatCatalogUsd,
  freeHostedModelClassCopy,
  hostedApiEconomicsSoftLine,
  hostedApiSavingsCopy,
} from "@vantage/billing/catalog";

type PlanCard = {
  code: string;
  name: string;
  price: string;
  period?: string;
  tagline: string;
  featured?: boolean;
  flag?: string;
  features: string[];
};

const free = PRICING_CATALOG.free;
const pro = PRICING_CATALOG.pro;
const proPlus = PRICING_CATALOG.pro_plus;
const max = PRICING_CATALOG.max;
const creditsLine = hostedApiSavingsCopy();
const economicsSoft = hostedApiEconomicsSoftLine();

/**
 * The ladder: every feature on every plan — cards list ONLY what actually differs
 * (the hosted AI allowance). The shared feature list renders once, below.
 */
const ladder: PlanCard[] = [
  {
    code: "free",
    name: free.label,
    price: formatCatalogUsd(free.monthlyUsd),
    tagline: "Every feature · your keys or local AI",
    flag: "Start here",
    features: [
      free.hostedNote,
      "Bring your own keys or run local — unlimited by Vantage",
      "Hard stop when the allowance runs out — no surprise bills",
    ],
  },
  {
    code: "pro",
    name: pro.label,
    price: formatCatalogUsd(pro.monthlyUsd),
    tagline: "Hosted AI without your own keys",
    featured: true,
    flag: "Most teams",
    features: [
      pro.hostedNote,
      "No provider account needed — Vantage routes and meters it",
      "Your own keys and local models stay unlimited",
    ],
  },
  {
    code: "pro_plus",
    name: proPlus.label,
    price: formatCatalogUsd(proPlus.monthlyUsd),
    tagline: "More hosted AI for busy seasons",
    features: [
      proPlus.hostedNote,
      "Room for scouting-night crunches and event weeks",
      "Your own keys and local models stay unlimited",
    ],
  },
  {
    code: "max",
    name: max.label,
    price: formatCatalogUsd(max.monthlyUsd),
    tagline: "The most hosted AI we sell",
    features: [
      max.hostedNote,
      "Covers heavy CAD, strategy, and code sessions all season",
      "Your own keys and local models stay unlimited",
    ],
  },
];

/** Shown ONCE — the same product on every plan, Free included. */
const everyPlanFeatures = [
  "Scouting with offline sync and data trust checks",
  "Match prediction, strategy, and alliance selection desks",
  "Event day, pit operations, and competition logistics",
  "CAD agent for Onshape and Fusion, plus design review",
  "Robot-code review and the team coding assistant",
  "Team chat, calendar, playbook, and member management",
  "Finance, purchasing, outreach, awards, and impact tracking",
  "AI budgets with hard caps — an append-only usage ledger you can read",
];

const faqs: Array<{ q: string; a: string }> = [
  {
    q: "Is anything locked behind a paid plan?",
    a: "No. Every feature ships on every plan, including Free. Paid plans only add hosted AI allowance so your team does not need its own provider keys.",
  },
  {
    q: "What can I plug in on the free plan?",
    a: byokEveryPlanCopy(),
  },
  {
    q: "What models does Free's hosted allowance use?",
    a: `${freeHostedModelClassCopy()} Paid plans route their allowance to frontier models.`,
  },
  {
    q: "What happens when a hosted allowance runs out?",
    a: "Hosted Chat stops when the included allowance is used up. You can buy credit packs, turn on pay-as-you-go with a spend cap, or keep working on your own keys or local models.",
  },
  {
    q: "Can we try team hosted AI before paying?",
    a: `Platform admins can grant a ${TEAM_TRIAL_DAYS}-day team trial with a hosted allowance for the week. Nothing auto-charges unless you subscribe.`,
  },
  {
    q: "Do hosted credits cost more than using our own keys?",
    a: economicsSoft,
  },
];

function Cta({ label = "Join the waitlist", href = "/#waitlist" }: { label?: string; href?: string }) {
  return (
    <a className="text-link" href={href}>
      {label}
    </a>
  );
}

function PlanArticle({ plan, footer }: { plan: PlanCard; footer?: ReactNode }) {
  return (
    <article className={plan.featured ? "featured" : undefined}>
      {plan.flag ? <em className="plan-flag">{plan.flag}</em> : null}
      <span className="plan-signal">{plan.tagline}</span>
      <h2>{plan.name}</h2>
      <div className="plan-price">
        <strong>{plan.price}</strong>
        <small>/ {plan.period ?? "month"}</small>
      </div>
      <ul>
        {plan.features.map((feature) => (
          <li key={feature}>{feature}</li>
        ))}
      </ul>
      {footer ?? <Cta />}
    </article>
  );
}

export function PricingCatalog() {
  return (
    <>
      <section className="pricing-plans" aria-label="Plans">
        <p className="pricing-savings-callout">
          <strong>{everyPlanValueLine()}</strong> The only thing that changes between plans is how much hosted AI
          is included: {free.label} ${free.includedAllowanceUsd} on budget models · {pro.label} $
          {pro.includedAllowanceUsd} · {proPlus.label} ${proPlus.includedAllowanceUsd} · {max.label} $
          {max.includedAllowanceUsd} on frontier models.
        </p>
        <div className="pricing-grid pricing-grid-team">
          {ladder.map((plan) =>
            plan.code === "free" ? (
              <PlanArticle
                key={plan.code}
                plan={plan}
                footer={
                  <a className="text-link" href="/#waitlist">
                    Join the waitlist
                  </a>
                }
              />
            ) : (
              <PlanArticle key={plan.code} plan={plan} />
            ),
          )}
        </div>
      </section>

      <section className="pricing-plans" aria-label="Everything included on every plan" id="included">
        <h2>Everything below is on every plan — Free included.</h2>
        <div className="pricing-grid pricing-grid-team">
          <article>
            <span className="plan-signal">The whole product</span>
            <ul>
              {everyPlanFeatures.map((feature) => (
                <li key={feature}>{feature}</li>
              ))}
            </ul>
          </article>
          <article>
            <span className="plan-signal">Your AI, your choice</span>
            <h2>Bring any key. Or none.</h2>
            <p className="pricing-card-note">{byokEveryPlanCopy()}</p>
            <p className="pricing-card-note">
              Hosted allowances sit on top: Vantage-routed models with metering, hard caps, and a readable
              ledger — so a booster club card is never surprised.
            </p>
            <Cta label="Add AI keys" href="/team/ai-keys" />
          </article>
        </div>
      </section>

      <section id="credits" className="pricing-credits">
        <h2>Buy AI credits</h2>
        <p>
          Available on Free and every paid plan when you want more hosted usage. {creditsLine} {economicsSoft}
        </p>
        <div className="pricing-grid">
          {[
            { code: "credits_100", label: "$100", detail: "Good for light hosted use" },
            { code: "credits_250", label: "$250", detail: "Most common top-up" },
            { code: "credits_500", label: "$500", detail: "Heavy event / season stretch" },
          ].map((pack) => (
            <article key={pack.code}>
              <span className="plan-signal">Credit pack</span>
              <h2>{pack.label}</h2>
              <p className="pricing-card-note">{pack.detail}</p>
              <Cta label="Join waitlist for credits" />
            </article>
          ))}
        </div>
      </section>

      <section className="pricing-trial">
        <h2>Try team hosted AI for {TEAM_TRIAL_DAYS} days</h2>
        <p>
          Platform admins can grant a week team trial with a hosted allowance for the trial window. No surprise
          auto-charge unless you subscribe.
        </p>
      </section>

      <section className="pricing-faq" aria-label="Pricing questions" id="faq">
        <h2>Questions teams ask</h2>
        {faqs.map((faq) => (
          <details key={faq.q} style={{ borderTop: "1px solid var(--m-line)" }}>
            {/* padding keeps the tap target comfortably >= 44px on phones */}
            <summary style={{ padding: "14px 0", cursor: "pointer", fontWeight: 600 }}>{faq.q}</summary>
            <p style={{ margin: "0 0 16px", maxWidth: "70ch", color: "var(--m-muted)", lineHeight: 1.6 }}>
              {faq.a}
            </p>
          </details>
        ))}
      </section>
    </>
  );
}
