import type { MetadataRoute } from "next";

const canonicalUrl = "https://vantage-frc-web.vercel.app";

export default function sitemap(): MetadataRoute.Sitemap {
  return ["", "/features", "/features/strategy", "/features/cad", "/features/code", "/workflow", "/pricing", "/privacy", "/terms"].map((path) => ({
    url: `${canonicalUrl}${path}`,
    lastModified: new Date("2026-07-15"),
    changeFrequency: path ? "monthly" : "weekly",
    priority: path ? 0.5 : 1,
  }));
}
