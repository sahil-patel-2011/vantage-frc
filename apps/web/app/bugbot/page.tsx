import { CodeClient } from "../code/code-client";
import "../code/code.css";

export const metadata = {
  title: "AI Bugbot",
  description:
    "Scan connected GitHub robot-code with subscription Bugbot or Bugbot Ultra ($1 scan, $2 fix, $1 recheck). Findings must quote the source. Never deploys or pushes.",
};

export default async function BugbotPage({
  searchParams,
}: {
  searchParams: Promise<{ orgId?: string }>;
}) {
  const { orgId } = await searchParams;
  return <CodeClient orgId={orgId ?? ""} />;
}
