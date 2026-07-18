import PackingClient from "./packing-client";
import "./packing.css";

export const metadata = {
  title: "Packing Lists · Vantage",
  description: "Competition load-out checklists so nothing gets left in the shop.",
};

export default function PackingPage() {
  return <PackingClient />;
}
