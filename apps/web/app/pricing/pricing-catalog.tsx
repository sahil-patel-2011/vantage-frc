"use client";

import { useMemo, useState, type ReactNode } from "react";
import {
  PRICING_CATALOG,
  TEAM_TRIAL_DAYS,
  formatCatalogUsd,
  hostedApiEconomicsSoftLine,
  hostedApiSavingsCopy,
  teamCommitRangeCopy,
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

const access = PRICING_CATALOG.access;
const individualPro = PRICING_CATALOG.individual_pro;
const individualMax = PRICING_CATALOG.individual_max;
const teamPro = PRICING_CATALOG.team_pro;
const teamMax = PRICING_CATALOG.team_max;
const teamRange = teamCommitRangeCopy();
const creditsLine = hostedApiSavingsCopy();
const economicsSoft = hostedApiEconomicsSoftLine();

const freePlan: PlanCard = {
  code: "free",
  name: "Free",
  price: "$0",
  tagline: "Competition core · your keys or buy credits",
  featured: true,
  flag: "Start here",
  features: [
    "Scouting, strategy, Event Day, and team ops",
    "Bring your own keys — or buy AI credits anytime",
    "Credits go further than typical own-key rates",
    "Hard stop when credits run out — no surprise bills",
  ],
};

const individualPlans: PlanCard[] = [
  {
    code: "individual_pro",
    name: "Individual Pro",
    price: formatCatalogUsd(individualPro.monthlyUsd),
    tagline: "Hosted AI for one person",
    featured: true,
    flag: "Popular",
    features: [
      "Vantage-hosted AI in the product",
      "Private workspace with hard usage cutoffs",
      "Buy AI credits anytime you need more",
    ],
  },
  {
    code: "individual_max",
    name: "Individual Max",
    price: formatCatalogUsd(individualMax.monthlyUsd),
    tagline: "More capacity · higher priority",
    features: [
      "More hosted AI capacity than Pro",
      "Priority features and heavier workloads",
      "Same credit top-ups when you need more",
    ],
  },
];

const teamPlans: PlanCard[] = [
  {
    code: "team_pro",
    name: "Team Pro",
    price: formatCatalogUsd(teamPro.monthlyUsd),
    tagline: "Shared hosted AI for the org",
    featured: true,
    flag: "Most teams",
    features: [
      "Hosted AI for the whole team",
      "Shared Event Day, Pit, and org controls",
      "Pooled AI credits when you need more",
    ],
  },
  {
    code: "team_max",
    name: "Team Max",
    price: formatCatalogUsd(teamMax.monthlyUsd),
    tagline: "Full org · highest capacity",
    features: [
      "Highest hosted capacity for the season",
      "Advanced CAD, strategy, and admin tools",
      "Credit packs when the team outgrows the plan",
    ],
  },
];

const creditPacks = [
  { code: "credits_100", label: "$100", detail: "Good for light hosted use" },
  { code: "credits_250", label: "$250", detail: "Most common top-up" },
  { code: "credits_500", label: "$500", detail: "Heavy event / season stretch" },
];

function Cta({ label = "Join early access", href = "/#waitlist" }: { label?: string; href?: string }) {
  return (
    <a className="button primary" href={href}>
      {label}
    </a>
  );
}

function PlanArticle({
  plan,
  footer,
}: {
  plan: PlanCard;
  footer?: ReactNode;
}) {
  return (
    <article className={plan.featured ? "featured" : undefined}>
      {plan.featured && plan.flag ? <em className="plan-flag">{plan.flag}</em> : null}
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
  const [group, setGroup] = useState<"individual" | "team">("individual");
  const plans = useMemo(() => (group === "individual" ? individualPlans : teamPlans), [group]);

  return (
    <>
      <section className="pricing-plans pricing-free-lead" aria-label="Start free">
        <div className="pricing-grid pricing-grid-free">
          <PlanArticle
            plan={freePlan}
            footer={
              <div className="pricing-card-actions">
                <a className="button primary" href="/team/ai-keys">
                  Start free · add keys
                </a>
                <a className="button secondary" href="#credits">
                  Buy AI credits
                </a>
              </div>
            }
          />
        </div>
        <p className="pricing-ladder-hint">
          Free → Individual → Team. AI credits top up hosted usage on every plan.
        </p>
      </section>

      <section className="pricing-plans" aria-label="Paid plans">
        <div className="pricing-plans-chrome">
          <div className="pricing-toggle" role="tablist" aria-label="Individual or Team">
            <button
              id="pricing-tab-individual"
              type="button"
              role="tab"
              aria-selected={group === "individual"}
              aria-controls="pricing-plan-panel"
              className={group === "individual" ? "active" : undefined}
              onClick={() => setGroup("individual")}
            >
              Individual
            </button>
            <button
              id="pricing-tab-team"
              type="button"
              role="tab"
              aria-selected={group === "team"}
              aria-controls="pricing-plan-panel"
              className={group === "team" ? "active" : undefined}
              onClick={() => setGroup("team")}
            >
              Team
            </button>
          </div>
          <p className="pricing-savings-callout">
            <strong>{creditsLine}</strong> Paid plans add hosted AI in the product. Credits work the same way
            everywhere.
          </p>
        </div>

        <div
          id="pricing-plan-panel"
          role="tabpanel"
          aria-labelledby={group === "individual" ? "pricing-tab-individual" : "pricing-tab-team"}
          aria-live="polite"
        >
          <div className="pricing-grid pricing-grid-team">
            {plans.map((plan) => (
              <PlanArticle key={plan.code} plan={plan} />
            ))}
          </div>
        </div>
      </section>

      <section id="credits" className="pricing-credits">
        <h2>Buy AI credits</h2>
        <p>
          Available on Free and every paid plan. {creditsLine} {economicsSoft}
        </p>
        <div className="pricing-grid pricing-grid-credits">
          {creditPacks.map((pack) => (
            <article key={pack.code}>
              <span className="plan-signal">Credit pack</span>
              <h2>{pack.label}</h2>
              <p className="pricing-card-note">{pack.detail}</p>
              <Cta label="Join waitlist for credits" />
            </article>
          ))}
        </div>
      </section>

      <section id="alternates" className="pricing-alternates">
        <h2>Other options</h2>
        <p>
          Prefer no {teamRange} team subscription? Access is ${access.monthlyUsd}/mo for hosted routing, or use
          pay-as-you-go with a hard spend cap. Credits still apply.
        </p>
        <div className="pricing-grid pricing-grid-team">
          <PlanArticle
            plan={{
              code: "payg",
              name: "Pay as you go",
              price: "$0",
              period: "subscription",
              tagline: "Cap what you spend",
              features: [
                "Hosted AI with a monthly spend cap",
                "No large team subscription",
                "Hard stop at the cap",
              ],
            }}
          />
          <PlanArticle
            plan={{
              code: "access",
              name: "Access",
              price: formatCatalogUsd(access.monthlyUsd),
              tagline: "Light hosted routing",
              features: [
                "Unlocks Vantage-hosted AI routing",
                "Add credits or PAYG as you go",
                "Free stays your keys; Access is managed AI",
              ],
            }}
          />
        </div>
      </section>

      <section className="pricing-trial">
        <h2>Try team AI for {TEAM_TRIAL_DAYS} days</h2>
        <p>
          Platform admins can grant a week team trial with hosted AI for the trial window. No surprise auto-charge
          unless you subscribe.
        </p>
      </section>
    </>
  );
}
