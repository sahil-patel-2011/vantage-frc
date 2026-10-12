import type { Metadata } from "next";
import { MarketingPageActions, SiteFooter, SiteHeader } from "../../components/marketing/site-header";
import { ScrollReveal } from "../../components/marketing/scroll-reveal";
import { marketingPageMetadata } from "../../lib/marketing/seo";
import { MARKETING_HUBS, MARKETING_LEARN, MARKETING_MENU } from "../../lib/marketing/product-story";

export const metadata: Metadata = marketingPageMetadata({
  title: "Features — Vantage",
  description:
    "Everything inside Vantage for FRC teams: pit-first scouting and Quick scout, pick lists and match plans, tasks, hours and money, GitHub pull request reviews, Robot Blueprint, the CAD agent and guided learning.",
  path: "/features",
});

/** The order a visitor meets the app in: the event, the team, the robot, learning, the business. */
const ORDER = ["competition", "team", "build", "business"] as const;

const DEEP_DIVES: Partial<Record<(typeof ORDER)[number], { href: string; label: string }[]>> = {
  competition: [{ href: "/features/strategy", label: "Strategy and Ask AI" }],
  build: [
    { href: "/features/code", label: "Code Coach" },
    { href: "/features/cad", label: "The CAD agent" },
  ],
};

export default function FeaturesPage() {
  const hubs = ORDER.map((id) => MARKETING_HUBS.find((hub) => hub.id === id)!);
  const jump = [
    ...hubs.slice(0, 3).map((hub) => ({ id: hub.id, title: hub.title })),
    { id: MARKETING_LEARN.id, title: MARKETING_LEARN.title },
    ...hubs.slice(3).map((hub) => ({ id: hub.id, title: hub.title })),
    { id: "more", title: "Also included" },
  ];

  return (
    <div className="marketing-site marketing-lux">
      <SiteHeader />
      <main>
        <section className="mx-page-hero" aria-labelledby="features-title">
          <div className="mx-wrap">
            <p className="mx-eyebrow">Features</p>
            <h1 className="mx-display" id="features-title">
              Everything your team runs on.
            </h1>
            <p className="mx-lead">
              Vantage is organized the way a team works: Competition, Team, Build and Business, plus a place for new
              members to learn. Here is what is inside each one.
            </p>
            <MarketingPageActions companion={{ href: "/workflow", label: "How it works" }} />
          </div>
        </section>

        <nav className="mx-jump" aria-label="Jump to a workspace">
          <div className="mx-wrap">
            <ul>
              {jump.map((item) => (
                <li key={item.id}>
                  <a href={`#${item.id}`}>{item.title}</a>
                </li>
              ))}
            </ul>
          </div>
        </nav>

        <div className="mx-wrap">
          {hubs.slice(0, 3).map((hub) => (
            <HubSection
              key={hub.id}
              id={hub.id}
              eyebrow="Workspace"
              title={hub.title}
              promise={hub.promise}
              tabs={hub.modules}
              tools={hub.tools}
              links={DEEP_DIVES[hub.id]}
            />
          ))}
          <HubSection
            id={MARKETING_LEARN.id}
            eyebrow="Inside Build"
            title={MARKETING_LEARN.title}
            promise={MARKETING_LEARN.promise}
            tools={MARKETING_LEARN.tools}
          />
          {hubs.slice(3).map((hub) => (
            <HubSection
              key={hub.id}
              id={hub.id}
              eyebrow="Workspace"
              title={hub.title}
              promise={hub.promise}
              tabs={hub.modules}
              tools={hub.tools}
            />
          ))}
        </div>

        <section className="mx-section mx-band" id="more" aria-labelledby="more-title">
          <div className="mx-wrap">
            <header className="mx-head">
              <p className="mx-eyebrow">Also included</p>
              <h2 className="mx-h2" id="more-title">
                On every device, with your data in reach.
              </h2>
            </header>
            <ul className="mx-also" data-mx-reveal="">
              {MARKETING_MENU.map((item) => (
                <li key={item.title}>
                  <strong>{item.title}</strong>
                  <span>{item.copy}</span>
                  {item.href ? (
                    <a className="mx-link" href={item.href}>
                      About the desktop app
                    </a>
                  ) : null}
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section className="mx-section" aria-labelledby="features-cta-title">
          <div className="mx-wrap mx-cta-band">
            <h2 className="mx-h2" id="features-cta-title">
              Free for every FRC team.
            </h2>
            <p className="mx-lead">
              Vantage sets teams up one at a time. Join the waitlist, or sign in if your team already invited you.
            </p>
            <MarketingPageActions companion={{ href: "/signin", label: "Already invited? Sign in" }} />
          </div>
        </section>
      </main>
      <SiteFooter />
      <ScrollReveal />
    </div>
  );
}

function HubSection({
  id,
  eyebrow,
  title,
  promise,
  tabs,
  tools,
  links,
}: {
  id: string;
  eyebrow: string;
  title: string;
  promise: string;
  tabs?: readonly string[];
  tools: readonly { name: string; copy: string }[];
  links?: { href: string; label: string }[];
}) {
  return (
    <section className="mx-hub" id={id} aria-labelledby={`${id}-title`}>
      <div className="mx-hub-copy">
        <p className="mx-eyebrow">{eyebrow}</p>
        <h2 className="mx-h2" id={`${id}-title`}>
          {title}
        </h2>
        <p className="mx-lead">{promise}</p>
        {tabs ? (
          <ul className="mx-hub-tabs" aria-label={`${title} tabs`}>
            {tabs.map((tab) => (
              <li key={tab}>{tab}</li>
            ))}
          </ul>
        ) : null}
        {links?.map((link) => (
          <a className="mx-link" href={link.href} key={link.href}>
            {link.label}
          </a>
        ))}
      </div>
      <ul className="mx-tools" data-mx-reveal="">
        {tools.map((tool) => (
          <li key={tool.name}>
            <strong>{tool.name}</strong>
            <span>{tool.copy}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
