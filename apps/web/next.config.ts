import type { NextConfig } from "next";

const config: NextConfig = {
  transpilePackages: ["@vantage/core", "@vantage/db", "@vantage/billing"],
  poweredByHeader: false,
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
