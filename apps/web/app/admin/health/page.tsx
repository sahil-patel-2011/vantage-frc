import HealthClient from "./health-client";

export const metadata = {
  title: "Health · Platform admin",
};

export const dynamic = "force-dynamic";

/** Every module Vantage runs on: healthy, degraded, down or not set up, with the real errors. */
export default function AdminHealthPage() {
  return <HealthClient />;
}
