import SupportTicketsClient from "./support-tickets-client";
import "./support-tickets.css";

export const metadata = {
  title: "Support",
  description: "Submit a ticket to the Vantage platform owner when something breaks.",
};

export default function SupportTicketsPage() {
  return <SupportTicketsClient />;
}
