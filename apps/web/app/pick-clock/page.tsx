import PickClockClient from "./pick-clock-client";
import "./pick-clock.css";

export const metadata = {
  title: "Pick Clock · Vantage",
  description:
    "45-second alliance pick assistant — next best available team and why, tuned for a single glance under the selection clock.",
};

export default function PickClockPage() {
  return <PickClockClient />;
}
