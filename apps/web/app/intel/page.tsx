import IntelClient from "./intel-client";
import "./intel.css";

export const metadata = {
  title: "Research",
  description: "Look up an FRC team by number or name. Rank, record, matches, and alliances in one place.",
};

export default function IntelPage() {
  return <IntelClient />;
}
