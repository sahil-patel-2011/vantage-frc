import BusinessClient from "./business-client";
import "./business.css";

export const metadata = {
  title: "Business",
  description: "Money, sponsors, grants, and outreach.",
};

export default function BusinessPage() {
  return <BusinessClient />;
}
