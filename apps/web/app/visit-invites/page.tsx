import VisitInvitesClient from "./visit-invites-client";
import "./visit-invites.css";

export const metadata = {
  title: "Visit Invites - Vantage",
  description: "Schedule shop tours and demo days with mentor hosts, student demos, and guest RSVPs.",
};

export default function VisitInvitesPage() {
  return <VisitInvitesClient />;
}
