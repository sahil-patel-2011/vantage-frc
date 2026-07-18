import type { NextConfig } from "next";

/** Legacy / renamed routes — keep bookmarks working without dead ends. See docs/FEATURE_MAP.md. */
const LEGACY_REDIRECTS: Array<{ source: string; destination: string }> = [
  { source: "/knowledge", destination: "/team?tab=knowledge" },
  { source: "/knowledge/:path*", destination: "/team?tab=knowledge" },
  { source: "/repairs", destination: "/incidents" },
  { source: "/repairs/:path*", destination: "/incidents" },
  { source: "/meetings", destination: "/team?tab=calendar" },
  { source: "/meetings/:path*", destination: "/team?tab=calendar" },
  { source: "/config", destination: "/robot" },
  { source: "/config/:path*", destination: "/robot" },
  { source: "/changes", destination: "/decisions" },
  { source: "/changes/:path*", destination: "/decisions" },
  { source: "/command", destination: "/competition?tab=command" },
  { source: "/my-day", destination: "/competition?tab=my-day" },
  { source: "/strategy", destination: "/competition?tab=strategy" },
  { source: "/scouting", destination: "/competition?tab=scouting" },
  { source: "/pick-clock", destination: "/competition?tab=pick-clock" },
  { source: "/chemistry", destination: "/competition?tab=chemistry" },
  { source: "/tasks", destination: "/team?tab=todos" },
  { source: "/todos", destination: "/team?tab=todos" },
  { source: "/messages", destination: "/team?tab=messages" },
  { source: "/practice", destination: "/team?tab=practice" },
  { source: "/attendance", destination: "/team?tab=attendance" },
  { source: "/team/calendar", destination: "/team?tab=calendar" },
  { source: "/team/knowledge", destination: "/team?tab=knowledge" },
  { source: "/orders", destination: "/business?tab=orders" },
  { source: "/sponsorship", destination: "/business?tab=sponsorship" },
  { source: "/kickoff", destination: "/build?tab=kickoff" },
  { source: "/cad", destination: "/build?tab=cad" },
  { source: "/code", destination: "/build?tab=code" },
  { source: "/fmea", destination: "/build?tab=fmea" },
  { source: "/prototype-tracker", destination: "/build?tab=prototype" },
  { source: "/batteries", destination: "/build?tab=batteries" },
  { source: "/chat", destination: "/ai?tab=chat" },
  { source: "/team/budgets", destination: "/ai?tab=budgets" },
  { source: "/team/ai-policy", destination: "/ai?tab=governance" },
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
        { key: "Content-Security-Policy", value: "base-uri 'self'; object-src 'none'; frame-ancestors 'none'; form-action 'self'" },
        { key: "Permissions-Policy", value: "camera=(self), microphone=(self), geolocation=(), payment=(), usb=()" },
        { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
        { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
        { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
      ],
    }];
  },
};

export default config;
