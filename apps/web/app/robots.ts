import type { MetadataRoute } from "next";

const canonicalUrl = "https://vantage-frc-web.vercel.app";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: ["/", "/pricing", "/privacy", "/terms"],
      disallow: ["/api/", "/dashboard", "/scouting", "/intel", "/cad", "/settings"],
    },
    sitemap: `${canonicalUrl}/sitemap.xml`,
  };
}
