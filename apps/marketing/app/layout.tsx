import type { Metadata } from "next";
import Script from "next/script";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL("https://vantagefrc.com"),
  title: "Vantage — One source of truth for your FRC season",
  description: "Scouting, intelligence, strategy, live operations, prediction, CAD, and coding context for FIRST Robotics Competition teams.",
  openGraph: {
    title: "Vantage — Competition telemetry for your whole season",
    description: "Turn fragmented team data into one operational picture.",
    type: "website",
    siteName: "Vantage"
  },
  icons: { icon: "/icon.svg" }
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const domain = process.env.NEXT_PUBLIC_PLAUSIBLE_DOMAIN;
  return (
    <html lang="en">
      <body>
        {children}
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
