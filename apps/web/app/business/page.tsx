import dynamic from "next/dynamic";

const BusinessClient = dynamic(() => import("./business-client"));

export const metadata = {
  title: "Business",
  description: "Money, sponsors, grants, and outreach.",
};

export default function BusinessPage() {
  return <BusinessClient />;
}
