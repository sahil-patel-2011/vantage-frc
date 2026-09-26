// Scouting's Teams tab is Vantage's team lookup — one implementation, two front doors. Here it is
// titled "Teams", opens on what our scouts saw, and keeps the data-source controls folded away.
import IntelClient from "../../intel/intel-client";
import "../../intel/intel.css";

export const metadata = {
  title: "Teams",
};

export default function ScoutTeamsPage() {
  return <IntelClient variant="scouting" />;
}
