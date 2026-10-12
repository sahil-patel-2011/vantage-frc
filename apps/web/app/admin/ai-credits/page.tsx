import AiCreditsClient from "./ai-credits-client";

export const metadata = {
  title: "AI credits · Platform admin",
};

export const dynamic = "force-dynamic";

/** AI credit gifted to teams, and the operator's keys that pay for it. */
export default function AdminAiCreditsPage() {
  return <AiCreditsClient />;
}
