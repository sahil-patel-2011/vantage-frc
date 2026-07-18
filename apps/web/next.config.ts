import type { NextConfig } from "next";

/** Legacy / renamed routes — keep bookmarks working without dead ends. See docs/FEATURE_MAP.md. */
const LEGACY_REDIRECTS: Array<{ source: string; destination: string }> = [
  { source: "/knowledge", destination: "/team/knowledge" },
  { source: "/knowledge/:path*", destination: "/team/knowledge" },
  { source: "/repairs", destination: "/incidents" },
  { source: "/repairs/:path*", destination: "/incidents" },
  { source: "/meetings", destination: "/team/calendar" },
  { source: "/meetings/:path*", destination: "/team/calendar" },
  { source: "/config", destination: "/robot" },
  { source: "/config/:path*", destination: "/robot" },
  { source: "/changes", destination: "/decisions" },
  { source: "/changes/:path*", destination: "/decisions" },
  { source: "/travel", destination: "/logistics" },
  { source: "/travel/:path*", destination: "/logistics" },
];

const config: NextConfig = {
  transpilePackages: [
    "@vantage/agent",
    "@vantage/billing",
    "@vantage/cad",
    "@vantage/core",
    "@vantage/db",
    "@vantage/export-center",
    "@vantage/intel-research",
    "@vantage/prediction-strategy",
    "@vantage/reference",
    "@vantage/scouting",
  ],
  poweredByHeader: false,
  async redirects() {
    return LEGACY_REDIRECTS.map((entry) => ({ ...entry, permanent: false }));
  },
  async headers() {
    return [{
      source: "/(.*)",
      headers: [
        { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "X-Frame-Options", value: "DENY" },
      ],
    }];
  },
};

export default config;
