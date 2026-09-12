import type { Metadata } from "next";
import { SITE_URL } from "../site";

const OG_IMAGE = {
  url: "/vantage-social.svg",
  width: 1200,
  height: 630,
  alt: "Vantage — competition operations software for FRC teams",
} as const;

/** Shared defaults for public marketing + legal pages. */
export function marketingPageMetadata(input: {
  title: string;
  description: string;
  path: string;
}): Metadata {
  const title = input.title;
  const url = `${SITE_URL}${input.path === "/" ? "" : input.path}`;
  return {
    title: { absolute: title },
    description: input.description,
    alternates: { canonical: input.path },
    openGraph: {
      title,
      description: input.description,
      url,
      type: "website",
      siteName: "Vantage",
      images: [OG_IMAGE],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description: input.description,
      images: [OG_IMAGE.url],
    },
  };
}

/** Root layout metadata — metadataBase follows NEXT_PUBLIC_SITE_URL when set. */
export function rootMarketingMetadata(): Metadata {
  return {
    metadataBase: new URL(SITE_URL),
    title: {
      default: "Vantage — one login an FRC student can use without help",
      template: "%s — Vantage",
    },
    description:
      "Invite-only FRC software: scouting, CAD from a pasteable link, match video, and team ops. Google or an email code. Mentors invite exact emails.",
    manifest: "/manifest.webmanifest",
    alternates: { canonical: "/" },
    openGraph: {
      title: "Vantage — one login an FRC student can use without help",
      description:
        "Scout, paste a CAD link, watch match video, and run the team. Invite-only — no public signup.",
      url: SITE_URL,
      type: "website",
      siteName: "Vantage",
      images: [OG_IMAGE],
    },
    twitter: {
      card: "summary_large_image",
      title: "Vantage — one login an FRC student can use without help",
      description:
        "Invite-only FRC software: offline scouting, CAD from a link, match video, and team ops.",
      images: [OG_IMAGE.url],
    },
    robots: { index: true, follow: true },
    icons: { icon: "/icon.svg", apple: "/icon.svg" },
    appleWebApp: { capable: true, title: "Vantage" },
  };
}

/** Organization + SoftwareApplication JSON-LD — no fake ratings or review counts. */
export function organizationSoftwareJsonLd() {
  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Organization",
        "@id": `${SITE_URL}/#organization`,
        name: "Vantage",
        alternateName: ["Vantage FRC"],
        url: SITE_URL,
        email: "sahiljpatel2011@gmail.com",
        description:
          "Competition operations platform for FIRST Robotics Competition (FRC) teams.",
        logo: `${SITE_URL}/vantage-logo.svg`,
      },
      {
        "@type": "SoftwareApplication",
        "@id": `${SITE_URL}/#software`,
        name: "Vantage",
        applicationCategory: "BusinessApplication",
        operatingSystem: "Web",
        url: SITE_URL,
        description:
          "Invite-only FRC app: scouting, event day, strategy, alliance selection, season planning, CAD agent, Code, and metered assistant. Screens stay empty until official matches, scout, or connector data exists.",
        offers: {
          "@type": "Offer",
          price: "0",
          priceCurrency: "USD",
          description:
            "Free competition core with bring-your-own-key or local AI. Paid plans add Vantage-hosted AI as a service.",
          url: `${SITE_URL}/pricing`,
        },
        publisher: { "@id": `${SITE_URL}/#organization` },
      },
      {
        "@type": "WebSite",
        "@id": `${SITE_URL}/#website`,
        url: SITE_URL,
        name: "Vantage",
        publisher: { "@id": `${SITE_URL}/#organization` },
        inLanguage: "en-US",
      },
    ],
  };
}
