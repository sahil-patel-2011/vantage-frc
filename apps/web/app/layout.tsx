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
import { ConsentBanner } from "../components/consent-banner";
import { VercelWebAnalytics } from "../components/vercel-web-analytics";
import { rootMarketingMetadata } from "../lib/marketing/seo";

const inter = localFont({
  src: "../assets/fonts/inter-latin-variable.woff2",
  weight: "100 900",
  variable: "--font-inter",
  display: "swap",
});
const sourceSans = localFont({
  src: "../assets/fonts/source-sans-3-latin-variable.woff2",
  weight: "200 900",
  variable: "--font-source-sans",
  display: "swap",
});
const sourceSerif = localFont({
  src: "../assets/fonts/source-serif-4-latin-variable.woff2",
  weight: "200 900",
  adjustFontFallback: "Times New Roman",
  variable: "--font-source-serif",
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
  const themeBootstrap = `(function(){try{var p=(document.cookie.match(/(?:^|; )vantage-theme-pref=(light|dark|system)/)||[])[1]||localStorage.getItem("vantage-theme-pref");var c=document.cookie.match(/(?:^|; )vantage-theme=(light|dark)/);var s=localStorage.getItem("vantage-theme");var t;if(p==="system"){t=window.matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light";}else if(p==="light"||p==="dark"){t=p;}else{t=c?c[1]:(s==="dark"?"dark":"light");}document.documentElement.dataset.theme=t;document.documentElement.style.colorScheme=t;}catch(e){document.documentElement.dataset.theme="light";document.documentElement.style.colorScheme="light";}})();`;
  return (
    <html
      lang="en"
      data-theme="light"
      className={`${inter.variable} ${sourceSans.variable} ${sourceSerif.variable} ${ibmMono.variable}`}
      suppressHydrationWarning
    >
      <body>
        {/* beforeInteractive, not a raw <script> in <head>. A script tag rendered
            by React is ignored on the client and Next logs that on every page.
            This still runs before paint, so the theme is set before the first frame. */}
        <Script id="vantage-theme" strategy="beforeInteractive">
          {themeBootstrap}
        </Script>
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
      </body>
    </html>
  );
}
