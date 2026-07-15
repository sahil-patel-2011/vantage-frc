import type { Metadata } from "next";

export const metadata: Metadata = {
  metadataBase: new URL("https://vantage-frc-web.vercel.app"),
  title: "Vantage has moved",
  robots: { index: false, follow: true },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
