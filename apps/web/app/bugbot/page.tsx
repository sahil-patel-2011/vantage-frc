import { CodeClient } from "../code/code-client";
import "../code/code.css";

export const metadata = {
  title: "AI Bugbot · Vantage",
  description:
    "Metered FRC robot-code review. Findings must quote the submitted source. Never deploys to a robot.",
};

export default async function BugbotPage({
  searchParams,
}: {
  searchParams: Promise<{ orgId?: string }>;
}) {
  const { orgId } = await searchParams;
  return <CodeClient orgId={orgId ?? ""} />;
}
