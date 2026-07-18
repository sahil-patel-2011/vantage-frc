import StartClient from "./start-client";
import "./start.css";

export const metadata = {
  title: "Your path · Vantage",
  description: "Role and subteam onboarding checklists for your first weeks on the team.",
};

export default async function StartPage({
  searchParams,
}: {
  searchParams: Promise<{ orgId?: string }>;
}) {
  const { orgId } = await searchParams;
  return <StartClient orgId={orgId ?? null} />;
}
