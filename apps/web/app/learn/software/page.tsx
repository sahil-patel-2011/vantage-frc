import { SoftwareTrackClient } from "./software-track-client";
import "./software-track.css";

export const metadata = {
  title: "Software track",
  description:
    "Paced programming units from Java through PID, then motion, swerve, Choreo, PhotonVision, and gains. Official docs only.",
};

export default function SoftwareTrackPage() {
  return <SoftwareTrackClient />;
}
