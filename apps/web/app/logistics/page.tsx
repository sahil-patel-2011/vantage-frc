import LogisticsClient from "./logistics-client";

export const metadata = {
  title: "Logistics · Vantage",
  description: "Event lodging, travel notes, and day-of checklists — offline-capable after one online visit.",
};

export default function LogisticsPage() {
  return <LogisticsClient />;
}
