import BatteriesClient from "./batteries-client";
import "./batteries.css";

export const metadata = {
  title: "Batteries",
  description: "Track FRC battery charge cycles, assignment, and competition readiness.",
};

export default function BatteriesPage() {
  return <BatteriesClient />;
}
