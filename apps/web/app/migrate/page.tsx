import MigrateClient from "./migrate-client";
import "./migrate.css";

export const metadata = {
  title: "Bring your season",
  description: "Import your calendar, scouting CSV, and Notion pages into Vantage.",
};

export default function MigratePage() {
  return <MigrateClient />;
}
