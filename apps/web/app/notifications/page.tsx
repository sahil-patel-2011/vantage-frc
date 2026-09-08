import NotificationsClient from "./notifications-client";

export const metadata = {
  title: "Notifications",
};

export default async function NotificationsPage({
  searchParams,
}: {
  searchParams: Promise<{ orgId?: string }>;
}) {
  const { orgId } = await searchParams;
  return <NotificationsClient orgId={orgId ?? null} />;
}
