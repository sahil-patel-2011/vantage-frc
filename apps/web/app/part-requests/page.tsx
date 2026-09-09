import PartRequestsClient from "./part-requests-client";
import "./part-requests.css";

export const metadata = {
  title: "Part requests",
  description: "Ask for a part you need. Mentors approve, and the cost lands on the season budget.",
};

export default function PartRequestsPage() {
  return <PartRequestsClient />;
}
