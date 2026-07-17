import VideoClient from "./video-client";
import "./video.css";

export const metadata = {
  title: "Match Video Review · Vantage",
  description: "Re-watch match footage with timestamped team notes that seek the player.",
};

export default function VideoPage() {
  return <VideoClient />;
}
