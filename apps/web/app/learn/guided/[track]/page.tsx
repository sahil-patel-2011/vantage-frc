import { notFound } from "next/navigation";
import { guidedTrack } from "../../../../lib/guided/tracks";
import { GuidedTrackClient } from "./guided-track-client";
import "../guided.css";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ track: string }> };

export default async function GuidedTrackPage({ params }: Props) {
  const { track: id } = await params;
  const track = guidedTrack(id);
  if (!track) notFound();
  return <GuidedTrackClient track={track} />;
}
