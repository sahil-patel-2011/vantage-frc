import type { Metadata } from "next";
import Script from "next/script";
import "./marketing.css";
import "./styles.css";
import PwaRegister from "./pwa-register";

const canonicalUrl = "https://vantage-frc-web.vercel.app";

export const metadata: Metadata = {
  metadataBase: new URL(canonicalUrl),
  title: "Vantage — One source of truth for your FRC season",
  description: "Scouting, intelligence, strategy, live operations, prediction, CAD, and coding context for FIRST Robotics Competition teams.",
  manifest: "/manifest.webmanifest",
  alternates: { canonical: "/" },
  openGraph: {
    title: "Vantage — Competition telemetry for your whole season",
    description: "Turn fragmented team data into one operational picture.",
    url: canonicalUrl,
    type: "website",
    siteName: "Vantage",
  },
  robots: { index: true, follow: true },
  icons: { icon: "/icon.svg" },
  appleWebApp: { capable: true, title: "Vantage" },
};

export default function Layout({ children }: { children: React.ReactNode }) {
  const domain = process.env.NEXT_PUBLIC_PLAUSIBLE_DOMAIN;
  return <html lang="en"><body><PwaRegister />{children}{domain && (
    <Script
      defer
      data-domain={domain}
      src={process.env.PLAUSIBLE_SCRIPT_URL ?? "https://plausible.io/js/script.js"}
      strategy="afterInteractive"
    />
  )}</body></html>;
}
