import { loadHoursBoard } from "../api/hours/route";
import { withPagePaint } from "../../lib/page-org";
import HoursClient from "./hours-client";
import "./hours.css";

export const metadata = {
  title: "Shop hours",
  description: "Clock in and out of the shop, see who's here now, and track season hour goals.",
};

export const dynamic = "force-dynamic";

export default async function HoursPage({
  searchParams,
}: {
  searchParams: Promise<{ orgId?: string }>;
}) {
  const { orgId } = await searchParams;
  const view = await withPagePaint("/hours", orgId, ({ client, userId, orgId: resolved }) =>
    loadHoursBoard(client, userId, resolved),
  );
  return <HoursClient initial={view} />;
}
