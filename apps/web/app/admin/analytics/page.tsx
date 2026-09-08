import AdminAnalyticsClient from "./analytics-client";

export const metadata = {
  title: "Platform analytics",
};

export const dynamic = "force-dynamic";

export default function AdminAnalyticsPage() {
  return <AdminAnalyticsClient />;
}
