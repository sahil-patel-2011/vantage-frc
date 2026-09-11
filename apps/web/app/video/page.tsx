import dynamic from "next/dynamic";

const VideoRescoutClient = dynamic(() => import("./video-rescout-client"));

export const metadata = {
  title: "Match video",
  description: "Watch a match clip, pause, rewind, and stamp what happened on the timeline.",
};

export default function VideoPage() {
  return <VideoRescoutClient />;
}
