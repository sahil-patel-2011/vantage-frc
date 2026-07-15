import type { MetadataRoute } from "next";

export default function sitemap(): MetadataRoute.Sitemap {
  return ["", "/privacy", "/terms"].map((path) => ({
    url: `https://vantagefrc.com${path}`,
    lastModified: new Date("2026-07-14"),
    changeFrequency: path ? "monthly" : "weekly",
    priority: path ? 0.4 : 1
  }));
}
