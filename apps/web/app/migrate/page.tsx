import MigrateClient from "./migrate-client";
import "./migrate.css";

export const metadata = {
  title: "Bring your season · Vantage",
  description: "Import ICS, scouting CSV, and Notion into Vantage — never invent events.",
};

export default function MigratePage() {
  return <MigrateClient />;
}
