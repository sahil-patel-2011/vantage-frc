import type { NextConfig } from "next";
import { expandLegacyRedirects } from "./lib/nav/legacy-redirects";

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
    return expandLegacyRedirects();
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
