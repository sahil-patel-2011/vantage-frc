import DutiesClient from "./duties-client";
import "./duties.css";

export const metadata = {
  title: "Duties · Vantage",
  description: "Who is on duty or chaperoning — empty until assigned, then My Day can read it.",
};

export default function DutiesPage() {
  return <DutiesClient />;
}
