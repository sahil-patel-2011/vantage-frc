"use client";

import { useMemo, useState, type ReactNode } from "react";
import {
  PRICING_CATALOG,
  TEAM_TRIAL_DAYS,
  formatCatalogUsd,
  hostedApiSavingsCopy,
  hostedCreditPackListApiUsd,
  hostedUsageDebitCopy,
  teamCommitRangeCopy,
} from "@vantage/billing/catalog";

type PlanCard = {
  code: string;
  name: string;
  price: string;
  period?: string;
  signal: string;
  featured?: boolean;
  flag?: string;
  features: string[];
  note?: string;
};

const access = PRICING_CATALOG.access;
const individualPro = PRICING_CATALOG.individual_pro;
const individualMax = PRICING_CATALOG.individual_max;
const teamPro = PRICING_CATALOG.team_pro;
const teamMax = PRICING_CATALOG.team_max;
const teamTrial = PRICING_CATALOG.team_trial;
const teamRange = teamCommitRangeCopy();
const hostedDebit = hostedUsageDebitCopy();
const hostedSavings = hostedApiSavingsCopy();

const individualPlans: PlanCard[] = [
  {
    code: "free",
    name: "Free",
    price: "$0",
    signal: "BYOK · $0 managed",
    features: [
      "Soft-UI competition core: scouting, strategy, Event Day / Pit ops",
      "Bring your own key or a local OpenAI-compatible relay",
      "Managed routing is stronger via tools and context—not BYOK sabotage",
      "No included managed API; no silent paid-model routing",
    ],
  },
  {
    code: "individual_pro",
    name: "Individual Pro",
    price: formatCatalogUsd(individualPro.monthlyUsd),
    signal: `$${individualPro.includedAllowanceUsd} API included`,
    featured: true,
    flag: "Popular",
    features: [
      `$${individualPro.includedAllowanceUsd}/mo managed API, then hard cut-off`,
      "Hosted AI ~25% cheaper than BYOK (0.75× typical rates)",
      "Private Soft-UI: scouting trust, strategy, CAD review",
      "After allowance: Usage Credits or PAYG with a spend cap",
    ],
  },
  {
    code: "individual_max",
    name: "Individual Max",
    price: formatCatalogUsd(individualMax.monthlyUsd),
    signal: `$${individualMax.includedAllowanceUsd} API · 2× limits`,
    features: [
      `$${individualMax.includedAllowanceUsd}/mo managed API, then hard cut-off`,
      "~2× Pro hourly, rate, and concurrency limits",
      "Priority Soft-UI features and scenario sweeps",
      "After allowance: Usage Credits or PAYG + spend cap",
    ],
  },
];

const teamPlans: PlanCard[] = [
  {
    code: "team_pro",
    name: "Team Pro",
    price: formatCatalogUsd(teamPro.monthlyUsd),
    signal: `$${teamPro.includedAllowanceUsd} pooled API`,
    featured: true,
    flag: "Most teams",
    features: [
      `$${teamPro.includedAllowanceUsd}/mo pooled managed API, then hard cut-off`,
      "Hosted AI ~25% cheaper than BYOK (0.75× typical rates)",
      "Shared Soft-UI AI, Event Day / Pit / logistics",
      "After allowance: pooled Credits or PAYG with a monthly cap",
    ],
  },
  {
    code: "team_max",
    name: "Team Max",
    price: formatCatalogUsd(teamMax.monthlyUsd),
    signal: `$${teamMax.includedAllowanceUsd} API · 2× limits`,
    features: [
      `$${teamMax.includedAllowanceUsd}/mo pooled managed API, then hard cut-off`,
      "~2× Team Pro rate, hourly, and concurrency limits",
      "Advanced CAD, strategy, code review, and admin",
      "Higher credit packs available when you need more API",
    ],
  },
];

const creditPackOptions = [
  {
    value: "team_max",
    label: `$${teamMax.monthlyUsd}/mo ($${teamMax.includedAllowanceUsd} included API)`,
  },
  {
    value: "credits_100",
    label: `Credits $100 ≈ $${hostedCreditPackListApiUsd(100)} typical API`,
  },
  {
    value: "credits_250",
    label: `Credits $250 ≈ $${hostedCreditPackListApiUsd(250)} typical API`,
  },
  {
    value: "credits_500",
    label: `Credits $500 ≈ $${hostedCreditPackListApiUsd(500)} typical API`,
  },
];

const alternatePaths: PlanCard[] = [
  {
    code: "payg",
    name: "Pay as you go",
    price: "$0",
    period: "subscription",
    signal: "No big subscription",
    features: [
      "Enroll PAYG with a payment method and hard monthly spend cap",
      hostedDebit,
      "Hard stop when credits and/or the spend cap are exhausted",
      `Best without a ${teamRange} team commit`,
    ],
  },
  {
    code: "access",
    name: "Access + PAYG",
    price: formatCatalogUsd(access.monthlyUsd),
    signal: "Light · managed routing",
    features: [
      `$${access.monthlyUsd}/mo unlocks managed Soft-UI routing`,
      hostedSavings,
      "No large included bucket — add Credits or enable PAYG",
      "Free stays BYOK/local; Access is managed without a big allowance",
    ],
  },
];

function Cta({ label = "Join early access" }: { label?: string }) {
  return (
    <a className="button primary" href="/#waitlist">
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
      <span className="plan-signal">{plan.signal}</span>
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
      {plan.note ? <p className="pricing-card-note">{plan.note}</p> : null}
    </article>
  );
}

export function PricingCatalog() {
  const [group, setGroup] = useState<"individual" | "team">("individual");
  const [teamMaxOption, setTeamMaxOption] = useState("team_max");

  const plans = useMemo(() => (group === "individual" ? individualPlans : teamPlans), [group]);

  return (
    <>
      <section className="pricing-plans" aria-label="Plan catalog">
        <div className="pricing-plans-chrome">
          <div className="pricing-toggle" role="tablist" aria-label="Pricing groups">
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
            <strong>25% less than BYOK.</strong> {hostedSavings}
          </p>
        </div>

        <div
          id="pricing-plan-panel"
          role="tabpanel"
          aria-labelledby={group === "individual" ? "pricing-tab-individual" : "pricing-tab-team"}
          aria-live="polite"
        >
          <div className={`pricing-grid ${group === "team" ? "pricing-grid-team" : ""}`}>
            {plans.map((plan) => (
              <PlanArticle
                key={plan.code}
                plan={plan}
                footer={
                  plan.code === "team_max" ? (
                    <>
                      <label className="team-max-pack">
                        <span>Subscription &amp; credit packs</span>
                        <select
                          value={teamMaxOption}
                          onChange={(e) => setTeamMaxOption(e.target.value)}
                          aria-label="Team Max subscription or higher credit packs"
                        >
                          {creditPackOptions.map((opt) => (
                            <option key={opt.value} value={opt.value}>
                              {opt.label}
                            </option>
                          ))}
                        </select>
                      </label>
                      <Cta
                        label={
                          teamMaxOption === "team_max"
                            ? "Join early access"
                            : "Join waitlist for credit packs"
                        }
                      />
                    </>
                  ) : undefined
                }
              />
            ))}
          </div>
        </div>
      </section>

      <section id="alternates" className="pricing-alternates">
        <span className="section-id">ALTERNATE PATHS</span>
        <h2>Skip the big team commit.</h2>
        <p>
          Prefer no {teamRange} subscription? Use pure PAYG, or Access (${access.monthlyUsd}/mo) plus Usage Credits /
          PAYG for managed Soft-UI routing without a large included allowance.
        </p>
        <div className="pricing-grid pricing-grid-team">
          {alternatePaths.map((plan) => (
            <PlanArticle key={plan.code} plan={plan} />
          ))}
        </div>
      </section>

      <section className="pricing-trial">
        <span className="section-id">WEEK TEAM TRIAL</span>
        <h2>Try managed team AI for {TEAM_TRIAL_DAYS} days.</h2>
        <p>
          Platform admins can grant a week team trial with <strong>${teamTrial.includedAllowanceUsd}</strong> included
          managed API allowance. No surprise auto-charge after the trial unless you subscribe. Existing consent rules
          still apply.
        </p>
      </section>
    </>
  );
}
