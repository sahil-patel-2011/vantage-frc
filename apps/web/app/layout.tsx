import type { Metadata, Viewport } from "next";
import { IBM_Plex_Mono, Source_Sans_3, Source_Serif_4 } from "next/font/google";
import Script from "next/script";
import "./marketing.css";
import "./soft-ui.css";
import "./styles.css";
import PwaRegister from "./pwa-register";
import ThemeProvider from "./theme-provider";

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

const canonicalUrl = "https://vantage-frc-web.vercel.app";


export const metadata: Metadata = {
  metadataBase: new URL(canonicalUrl),
  title: "Vantage — One shared context for FRC decisions",
  description: "Competition operations software connecting FRC scouting, prediction, strategy, CAD, and code around the same event evidence.",
  manifest: "/manifest.webmanifest",
  alternates: { canonical: "/" },
  openGraph: {
    title: "Vantage — From match data to robot decisions",
    description: "One shared FRC context for scouting, prediction, strategy, CAD, and code.",
    url: canonicalUrl,
    type: "website",
    siteName: "Vantage",
    images: [{ url: "/vantage-social.svg", width: 1200, height: 630, alt: "Vantage — competition operations software for FRC teams" }],
  },
  twitter: { card: "summary_large_image", images: ["/vantage-social.svg"] },
  robots: { index: true, follow: true },
  icons: { icon: "/icon.svg", apple: "/icon.svg" },
  appleWebApp: { capable: true, title: "Vantage" },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#0b1014" },
  ],
};

export default function Layout({ children }: { children: React.ReactNode }) {
  const domain = process.env.NEXT_PUBLIC_PLAUSIBLE_DOMAIN;
  const themeBootstrap = `(function(){try{var c=document.cookie.match(/(?:^|; )vantage-theme=(light|dark)/);var s=localStorage.getItem("vantage-theme");var t=c?c[1]:(s==="dark"?"dark":"light");document.documentElement.dataset.theme=t;document.documentElement.style.colorScheme=t;}catch(e){document.documentElement.dataset.theme="light";document.documentElement.style.colorScheme="light";}})();`;
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
