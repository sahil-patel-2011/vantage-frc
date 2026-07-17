import type { MetadataRoute } from "next";
import { SITE_URL as canonicalUrl } from "../lib/site";

export default function robots(): MetadataRoute.Robots {
  return {
    // Public marketing/legal pages are crawlable (including AI crawlers, which we
    // intentionally allow for GEO); authenticated product + auth routes are excluded.
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: [
        "/api/",
        "/dashboard",
        "/workspace",
        "/scouting",
        "/intel",
        "/dossier",
        "/strategy",
        "/cad",
        "/code",
        "/chat",
        "/messages",
        "/exports",
        "/showcase",
        "/display",
        "/security",
        "/team",
        "/admin",
        "/invite",
        "/account",
        "/settings",
        "/sign-in",
        "/signin",
      ],
    },
    sitemap: `${canonicalUrl}/sitemap.xml`,
  };
}
