import VideoRescoutClient from "./video-rescout-client";
import "./video-rescout.css";

export const metadata = {
  title: "Match Video Review",
  description: "Post-match video re-scout: pause, rewind, 2x playback, and stamp scores on the YouTube timeline.",
};

export default function VideoPage() {
  return <VideoRescoutClient />;
}
