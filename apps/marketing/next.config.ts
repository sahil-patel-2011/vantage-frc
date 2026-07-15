import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  async redirects() {
    return [{
      source: "/:path*",
      destination: "https://vantage-frc-web.vercel.app/:path*",
      permanent: true,
    }];
  }
};

export default nextConfig;
