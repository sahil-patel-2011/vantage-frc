import { DashboardHomeSkeleton } from "./dashboard-now-card";
import "./dashboard-home.css";

/**
 * Shown the instant Home is tapped, while the route streams in: the same grey shapes Home draws
 * before its board arrives, so the switch to real content does not move anything. "Welcome" is
 * what Home itself says until it knows the local time.
 */
export default function DashboardLoading() {
  return <DashboardHomeSkeleton greetingText="Welcome" />;
}
