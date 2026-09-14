import { CodeClient } from "./code-client";
import "./code.css";

export const metadata = {
  title: "Code",
  description:
    "Flag risky robot-code patterns, explain why they matter, and propose human-approved diffs — not autonomous robot code.",
};

export default async function CodePage({
  searchParams,
}: {
  searchParams: Promise<{ orgId?: string }>;
}) {
  const { orgId } = await searchParams;
  return <CodeClient orgId={orgId ?? ""} />;
}
