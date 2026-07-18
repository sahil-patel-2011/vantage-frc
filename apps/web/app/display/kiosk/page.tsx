import KioskClient from "./kiosk-client";
import "../display.css";

export const metadata = {
  title: "Pit TV · Vantage",
  description: "Fullscreen competition display board for the pit TV.",
};

export default async function KioskPage({
  searchParams,
}: {
  searchParams: Promise<{ orgId?: string; boardId?: string; token?: string }>;
}) {
  return <KioskClient params={await searchParams} />;
}
