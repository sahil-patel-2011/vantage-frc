/** Site-wide JSON-LD structured data for SEO rich results + GEO (AI answer engines). */
import { SITE_URL as CANONICAL } from "../../lib/site";

const description =
  "Vantage is a competition operations platform for FIRST Robotics Competition (FRC) teams. It unifies offline scouting, live The Blue Alliance and Statbotics data, win/loss prediction, strategy and pick lists, AI CAD, and robot-code review in one source-attributed, team-private event context — with every AI action behind a human decision.";

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
      email: "hello@vantagefrc.com",
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
        "Live The Blue Alliance and Statbotics reference data",
        "Win/loss prediction with confidence and tracked accuracy",
        "Strategy, what-if scenarios, and alliance pick lists",
        "Event Day command and My Day personal queue",
        "Team knowledge/wiki and CAD↔strategy linkage",
        "Event logistics and sponsorship pipeline",
        "AI CAD builder (Onshape / Fusion, approval-gated)",
        "FRC robot-code risk review as human-approved diffs",
        "Pit and TV/kiosk displays",
        "Auditable data exports and team operations",
      ],
      offers: [
        { "@type": "Offer", name: "Free", price: "0", priceCurrency: "USD", description: "Complete non-AI competition core with BYOK or local AI; $0 managed API allowance." },
        { "@type": "Offer", name: "Access", price: "55", priceCurrency: "USD", description: "Light plan unlocking managed routing at provider list rates; use Usage Credits or PAYG." },
        { "@type": "Offer", name: "Individual Pro", price: "79", priceCurrency: "USD", description: "Private workspace with $50 included managed API allowance at list rates." },
        { "@type": "Offer", name: "Individual Max", price: "119", priceCurrency: "USD", description: "Private workspace with $85 included API and ~2× Pro rate limits." },
        { "@type": "Offer", name: "Team Pro", price: "229", priceCurrency: "USD", description: "Organization plan with $150 pooled managed API allowance." },
        { "@type": "Offer", name: "Team Max", price: "449", priceCurrency: "USD", description: "Organization plan with $300 pooled API and ~2× Team Pro rate limits." },
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
