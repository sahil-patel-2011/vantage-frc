import KioskClient from "../kiosk/kiosk-client";
import "../display.css";

export const metadata = {
  title: "Pit display",
  description: "Fullscreen 16:9 pit TV for a Raspberry Pi or kiosk stick — live snapshots only.",
};

export default async function PitDisplayPage({
  searchParams,
}: {
  searchParams: Promise<{ orgId?: string; boardId?: string; token?: string }>;
}) {
  return <KioskClient mode="pit" params={await searchParams} />;
}
