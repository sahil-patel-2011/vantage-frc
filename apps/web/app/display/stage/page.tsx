import StageClient from "./stage-client";
import "../display.css";
import "./stage.css";

export const metadata = {
  title: "Pit TV · Event board",
  description: "Follows the event on its own: next match, queue, rankings, alliance selection and the bracket.",
};

export default async function StageDisplayPage({
  searchParams,
}: {
  searchParams: Promise<{ orgId?: string; boardId?: string; token?: string }>;
}) {
  return <StageClient params={await searchParams} />;
}
