import PackingClient from "./packing-client";
import "./packing.css";

export const metadata = {
  title: "Packing Lists · Vantage",
  description: "Competition load-out checklists plus a request inbox so teammates can ask to pack extras without editing the master list.",
};

export default function PackingPage() {
  return <PackingClient />;
}
