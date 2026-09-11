import VideoRescoutClient from "./video-rescout-client";
import "./video-rescout.css";

export const metadata = {
  title: "Match video",
  description: "Watch a match clip, pause, rewind, and stamp what happened on the timeline.",
};

export default function VideoPage() {
  return <VideoRescoutClient />;
}
