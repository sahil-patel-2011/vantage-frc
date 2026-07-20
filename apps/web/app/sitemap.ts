import type { MetadataRoute } from "next";
import { SITE_URL } from "../lib/site";

/** Public marketing + legal routes only. Product surfaces stay out of the sitemap. */
const PUBLIC_PATHS: Array<{ path: string; changeFrequency: MetadataRoute.Sitemap[number]["changeFrequency"]; priority: number }> = [
  { path: "", changeFrequency: "weekly", priority: 1 },
  { path: "/features", changeFrequency: "weekly", priority: 0.9 },
  { path: "/features/strategy", changeFrequency: "monthly", priority: 0.7 },
  { path: "/features/cad", changeFrequency: "monthly", priority: 0.7 },
  { path: "/features/code", changeFrequency: "monthly", priority: 0.7 },
  { path: "/workflow", changeFrequency: "monthly", priority: 0.8 },
  { path: "/for-teams", changeFrequency: "monthly", priority: 0.8 },
  { path: "/pricing", changeFrequency: "weekly", priority: 0.9 },
  { path: "/privacy", changeFrequency: "yearly", priority: 0.3 },
  { path: "/terms", changeFrequency: "yearly", priority: 0.3 },
  { path: "/llms.txt", changeFrequency: "monthly", priority: 0.4 },
  { path: "/llms-full.txt", changeFrequency: "monthly", priority: 0.3 },
];

export default function sitemap(): MetadataRoute.Sitemap {
  const lastModified = new Date("2026-07-20");
  return PUBLIC_PATHS.map(({ path, changeFrequency, priority }) => ({
    url: `${SITE_URL}${path}`,
    lastModified,
    changeFrequency,
    priority,
  }));
}
