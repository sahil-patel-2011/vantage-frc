/** Site-wide JSON-LD structured data for SEO rich results + GEO (AI answer engines). */
import { PRICING_CATALOG } from "@vantage/billing/catalog";
import { SITE_URL as CANONICAL } from "../../lib/site";

const description =
  "Vantage is a competition operations platform for FIRST Robotics Competition (FRC) teams. It unifies offline scouting, live The Blue Alliance and Statbotics data, win/loss prediction, strategy and pick lists, AI CAD, and robot-code review in one source-attributed, team-private event context — with every AI action behind a human decision.";

const c = PRICING_CATALOG;

const graph = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Organization",
      "@id": `${CANONICAL}/#organization`,
      name: "Vantage",
      alternateName: "Vantage FRC",
      url: CANONICAL,
      logo: `${CANONICAL}/vantage-logo.svg`,
      email: "sahiljpatel2011@gmail.com",
      description,
    },
    {
      "@type": "WebSite",
      "@id": `${CANONICAL}/#website`,
      name: "Vantage",
      url: CANONICAL,
      publisher: { "@id": `${CANONICAL}/#organization` },
      description: "Competition operations software for FRC teams.",
      inLanguage: "en",
    },
    {
      "@type": "SoftwareApplication",
      "@id": `${CANONICAL}/#software`,
      name: "Vantage",
      alternateName: "Vantage FRC",
      url: CANONICAL,
      applicationCategory: "BusinessApplication",
      applicationSubCategory: "FRC scouting, strategy, and team operations software",
      operatingSystem: "Web browser, iOS (installable PWA)",
      description,
      publisher: { "@id": `${CANONICAL}/#organization` },
      audience: {
        "@type": "Audience",
        audienceType: "FIRST Robotics Competition (FRC) teams — coaches, mentors, and students",
      },
      featureList: [
        "Offline-first match and pit scouting with trust signals",
        "Custom scouting form builder with versioned schemas",
        "Opt-in scout voice notes",
        "Product hubs for Competition, Team, Business, Build, and AI",
        "Strategy tools and pick desk",
        "Business hub for sponsors, grants, and orders",
        "Hard managed-AI usage cutoffs after included allowance",
        "Live The Blue Alliance and Statbotics reference data",
        "Win/loss prediction with confidence and tracked accuracy",
        "Event Day command and My Day personal queue",
        "Team knowledge/wiki and CAD↔strategy linkage",
        "AI CAD builder (Onshape / Fusion, approval-gated)",
        "FRC robot-code risk review as human-approved diffs",
        "Pit and TV/kiosk displays",
        "Auditable data exports and team operations",
      ],
      offers: [
        {
          "@type": "Offer",
          name: "Free",
          price: "0",
          priceCurrency: "USD",
          description: "The complete competition core with bring-your-own-key or local AI.",
        },
        {
          "@type": "Offer",
          name: "Access",
          price: String(c.access.monthlyUsd),
          priceCurrency: "USD",
          description: "Light plan unlocking managed AI routing; hosted AI cheaper than typical BYOK.",
        },
        {
          "@type": "Offer",
          name: "Pro",
          price: String(c.pro.monthlyUsd),
          priceCurrency: "USD",
          description: "Every feature plus a hosted AI allowance — no keys needed to start.",
        },
        {
          "@type": "Offer",
          name: "Pro+",
          price: String(c.pro_plus.monthlyUsd),
          priceCurrency: "USD",
          description: "Every feature with a larger hosted AI allowance for busy season weeks.",
        },
        {
          "@type": "Offer",
          name: "Max",
          price: String(c.max.monthlyUsd),
          priceCurrency: "USD",
          description: "Every feature with the largest hosted AI allowance for all-season heavy use.",
        },
      ],
    },
  ],
};

export function StructuredData() {
  return (
    <script
      type="application/ld+json"
      // JSON.stringify output is safe to inline; no user input is included.
      dangerouslySetInnerHTML={{ __html: JSON.stringify(graph) }}
    />
  );
}
