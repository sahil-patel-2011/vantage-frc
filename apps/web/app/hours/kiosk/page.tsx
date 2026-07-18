import KioskClient from "./kiosk-client";
import "../hours.css";

export const metadata = {
  title: "Shop Kiosk · Vantage",
  description: "Tap-to-clock-in kiosk for the shop door — big buttons, live elapsed timers.",
};

export default function HoursKioskPage() {
  return <KioskClient />;
}
