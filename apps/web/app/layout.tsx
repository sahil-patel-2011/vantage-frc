import type { Metadata } from "next";
import "./styles.css";
import PwaRegister from "./pwa-register";

export const metadata: Metadata = {
  title: "Vantage",
  description: "Event-ready robotics scouting",
  manifest: "/manifest.webmanifest",
  robots: { index: false, follow: false },
  appleWebApp: { capable: true, title: "Vantage" },
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return <html lang="en"><body><PwaRegister />{children}</body></html>;
}
