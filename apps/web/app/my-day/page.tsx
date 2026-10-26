import { loadMyDay } from "../../lib/load-my-day";
import { withPagePaint } from "../../lib/page-org";
import MyDayClient from "./my-day-client";
import "./my-day.css";

export const metadata = {
  title: "My Day",
  description: "Your next match, bumper color, partners, and opponents — glanceable on the field.",
};

export const dynamic = "force-dynamic";

export default async function MyDayPage({
  searchParams,
}: {
  searchParams: Promise<{ orgId?: string }>;
}) {
  const { orgId } = await searchParams;
  const view = await withPagePaint("/my-day", orgId, ({ client, userId, orgId: resolved }) =>
    loadMyDay(client, { userId, orgId: resolved }),
  );
  return <MyDayClient initial={view} />;
}
