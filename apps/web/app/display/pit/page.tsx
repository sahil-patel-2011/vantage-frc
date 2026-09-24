import KioskClient from "../kiosk/kiosk-client";
import "../display.css";

export const metadata = {
  title: "Pit TV",
  description: "Fullscreen pit TV board: next match, countdown, bumper colour and the panels your team picked.",
};

export default async function PitDisplayPage({
  searchParams,
}: {
  searchParams: Promise<{ orgId?: string; boardId?: string; token?: string }>;
}) {
  return <KioskClient mode="pit" params={await searchParams} />;
}
