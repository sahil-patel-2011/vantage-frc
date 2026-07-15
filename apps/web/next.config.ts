import type { NextConfig } from "next";

const config: NextConfig = {
  transpilePackages: ["@vantage/core", "@vantage/db", "@vantage/billing"],
  poweredByHeader: false
};

export default config;
