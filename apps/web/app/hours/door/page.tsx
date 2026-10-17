import DoorClient from "./door-client";
import "../hours.css";
import "./door.css";

export const metadata = {
  title: "Door check-in",
  description: "A QR code for the shop door. Members scan it with their phone to check in and out.",
};

export default function HoursDoorPage() {
  return <DoorClient />;
}
