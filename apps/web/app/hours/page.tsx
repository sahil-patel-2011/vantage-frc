import HoursClient from "./hours-client";
import "./hours.css";

export const metadata = {
  title: "Shop hours",
  description: "Clock in and out of the shop, see who's here now, and track season hour goals.",
};

export default function HoursPage() {
  return <HoursClient />;
}
