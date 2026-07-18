import InspectionClient from "./inspection-client";
import "./inspection.css";

export const metadata = {
  title: "Robot Inspection · Vantage",
  description: "Self-inspect against the FRC checklist and track robot weigh-ins before the real inspector.",
};

export default function InspectionPage() {
  return <InspectionClient />;
}
