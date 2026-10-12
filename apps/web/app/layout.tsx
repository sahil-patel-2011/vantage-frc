import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import Script from "next/script";
// Last on purpose: system.css is the shared default layer (see its header).
// Leftover product chrome sheets load from product-styles.ts via AppShell
// and the public shells that need them — not from this root layout — so
// marketing routes do not download scout/intel/kiosk chrome.
import "./system.css";
import "./vantage-scan.css";
import "./vantage-kit.css";
// Last: motion + material tokens that later sheets and components read.
import "./vantage-fluid.css";
import "./vantage-redesign.css";
import PwaRegister from "./pwa-register";
import ThemeProvider from "./theme-provider";
import { AppBody } from "../components/app-body";
import { ConsentBanner } from "../components/consent-banner";
import { THEME_BOOTSTRAP_SCRIPT } from "../lib/theme/theme-bootstrap";
import { VercelWebAnalytics } from "../components/vercel-web-analytics";
import { rootMarketingMetadata } from "../lib/marketing/seo";

// One sans and one mono. Source Sans 3 and Source Serif 4 were loaded on every page beside Inter;
// their names now point at the one sans (system.css), so older rules still resolve.
const inter = localFont({
  src: "../assets/fonts/inter-latin-variable.woff2",
  weight: "100 900",
  variable: "--font-inter",
  display: "swap",
});
const ibmMono = localFont({
  src: [
    { path: "../assets/fonts/ibm-plex-mono-latin-400.woff2", weight: "400" },
    { path: "../assets/fonts/ibm-plex-mono-latin-500.woff2", weight: "500" },
    { path: "../assets/fonts/ibm-plex-mono-latin-600.woff2", weight: "600" },
  ],
  fallback: ["ui-monospace", "monospace"],
  adjustFontFallback: false,
  variable: "--font-ibm-mono",
  display: "swap",
});

export const metadata: Metadata = rootMarketingMetadata();

export const viewport: Viewport = {
  // Matches --bg in both themes, so the OS browser chrome does not paint a
  // different shade than the page behind it.
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f6f7f9" },
    { media: "(prefers-color-scheme: dark)", color: "#11161c" },
  ],
};

export default function Layout({ children }: { children: React.ReactNode }) {
  const domain = process.env.NEXT_PUBLIC_PLAUSIBLE_DOMAIN;
  return (
    <html
      lang="en"
      data-theme="light"
      className={`${inter.variable} ${ibmMono.variable}`}
      suppressHydrationWarning
    >
      <head>
        {/* A raw inline script, so the browser runs it while parsing <head>, before the first
            frame. next/script's beforeInteractive only queues inline code for Next's runtime in
            the App Router, which runs after paint: dark-mode users got a light first frame. This
            element is hydrated with the root layout, never created on the client, so React's
            "script tags are not executed" warning does not apply. */}
        <script id="vantage-theme" dangerouslySetInnerHTML={{ __html: THEME_BOOTSTRAP_SCRIPT }} />
      </head>
      {/* <body> carries the app frame's classes in the server HTML (has-app-shell and friends). */}
      <AppBody>
        <PwaRegister />
        <ThemeProvider>{children}</ThemeProvider>
        {/* Asks before any first-party product analytics are collected, and
            owns the route-change page-view tracker that the answer gates. */}
        <ConsentBanner />
        <VercelWebAnalytics />
        {domain && (
          <Script
            defer
            data-domain={domain}
            src={process.env.PLAUSIBLE_SCRIPT_URL ?? "https://plausible.io/js/script.js"}
            strategy="afterInteractive"
          />
        )}
      </AppBody>
    </html>
  );
}
