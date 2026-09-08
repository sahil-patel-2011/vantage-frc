import StageClient from "./stage-client";
import "../display.css";
import "./stage.css";

export const metadata = {
  title: "Event display",
  description:
    "Phase-aware pit TV: schedule, queue countdown, rankings, bracket, and sponsor thanks — synced rows only.",
};

export default async function StageDisplayPage({
  searchParams,
}: {
  searchParams: Promise<{ orgId?: string; boardId?: string; token?: string }>;
}) {
  return <StageClient params={await searchParams} />;
}
