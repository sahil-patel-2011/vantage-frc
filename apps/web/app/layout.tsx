import type { Metadata, Viewport } from "next";
import { IBM_Plex_Mono, Source_Sans_3, Source_Serif_4 } from "next/font/google";
import Script from "next/script";
import "./soft-ui.css";
import "./styles.css";
// Last on purpose: system.css is the shared default layer (see its header).
import "./system.css";
import PwaRegister from "./pwa-register";
import ThemeProvider from "./theme-provider";
import { ConsentBanner } from "../components/consent-banner";
import { rootMarketingMetadata } from "../lib/marketing/seo";

const sourceSans = Source_Sans_3({
  subsets: ["latin"],
  variable: "--font-source-sans",
  display: "swap",
});
const sourceSerif = Source_Serif_4({
  subsets: ["latin"],
  variable: "--font-source-serif",
  display: "swap",
});
const ibmMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-ibm-mono",
  display: "swap",
});

export const metadata: Metadata = rootMarketingMetadata();

export const viewport: Viewport = {
  // Matches --soft-bg in both themes, so the OS browser chrome does not paint a
  // different shade than the page behind it.
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#eef2f7" },
    { media: "(prefers-color-scheme: dark)", color: "#0c1118" },
  ],
};

export default function Layout({ children }: { children: React.ReactNode }) {
  const domain = process.env.NEXT_PUBLIC_PLAUSIBLE_DOMAIN;
  const themeBootstrap = `(function(){try{var p=(document.cookie.match(/(?:^|; )vantage-theme-pref=(light|dark|system)/)||[])[1]||localStorage.getItem("vantage-theme-pref");var c=document.cookie.match(/(?:^|; )vantage-theme=(light|dark)/);var s=localStorage.getItem("vantage-theme");var t;if(p==="system"){t=window.matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light";}else if(p==="light"||p==="dark"){t=p;}else{t=c?c[1]:(s==="dark"?"dark":"light");}document.documentElement.dataset.theme=t;document.documentElement.style.colorScheme=t;}catch(e){document.documentElement.dataset.theme="light";document.documentElement.style.colorScheme="light";}})();`;
  return (
    <html
      lang="en"
      data-theme="light"
      className={`${sourceSans.variable} ${sourceSerif.variable} ${ibmMono.variable}`}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeBootstrap }} />
      </head>
      <body>
        <PwaRegister />
        <ThemeProvider>{children}</ThemeProvider>
        {/* Asks before any first-party product analytics are collected, and
            owns the route-change page-view tracker that the answer gates. */}
        <ConsentBanner />
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
