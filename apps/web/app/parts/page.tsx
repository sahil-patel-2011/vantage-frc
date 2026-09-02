import PartsClient from "./parts-client";
import "./parts.css";

export const metadata = {
  title: "Parts · Vantage",
  description: "One parts ledger — stock, locations, spare forecast, and the spare robot kit in one place.",
};

export default function PartsPage() {
  return <PartsClient />;
}
