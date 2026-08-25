import GrantCalendarClient from "./calendar-client";

export const metadata = {
  title: "Grant calendar",
  description:
    "Upcoming FRC grant deadlines with eligibility filtering and per-member deadline alerts.",
};

export default async function GrantCalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ orgId?: string }>;
}) {
  const { orgId } = await searchParams;
  return <GrantCalendarClient orgId={orgId} />;
}
