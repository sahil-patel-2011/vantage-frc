import type { NextConfig } from "next";
import { expandLegacyRedirects } from "./lib/nav/legacy-redirects";

const config: NextConfig = {
  // Leftover volume kits under app/win-kit, app/lovat-kit, app/agent-kit are
  // moved out of app/ for `next build` by scripts/build-without-leftover-kits.mjs
  // (same skip as eslint / tsconfig / vitest / copy-lint / route-coverage). Do
  // not mass-edit the kits — compiling those ~1780 cloned pages OOMs CI.
  // Vercel Preview Comments cannot patch Next 16.3 immutable static output
  // (IMMUTABLE_STATIC_PATCH_PREVIEW_COMMENTS). Restore the default after
  // Preview Comments are off on the project.
  supportsImmutableAssets: false,
  // Dev only. 127.0.0.1 is the local stand-in for the Scouting host (see
  // lib/products/products.ts); without it the dev server withholds its scripts
  // there and the Scouting pages never hydrate.
  allowedDevOrigins: [
    "127.0.0.1",
    ...(process.env.BASE44_PUBLIC_HOST_SUFFIX ? [`3000-${process.env.BASE44_PUBLIC_HOST_SUFFIX}`] : []),
  ],
  serverExternalPackages: ["pg"],
  transpilePackages: [
    "@vantage/agent",
    "@vantage/billing",
    "@vantage/cad",
    "@vantage/core",
    "@vantage/db",
    "@vantage/export-center",
    "@vantage/free-relay",
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
    }, {
      // Windows PowerShell 5.1 `irm` decodes by charset; without one the
      // script's non-ASCII punctuation arrives garbled.
      source: "/team-setup.ps1",
      headers: [{ key: "Content-Type", value: "text/plain; charset=utf-8" }],
    }];
  },
};

export default config;
