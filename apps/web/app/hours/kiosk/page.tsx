import KioskClient from "./kiosk-client";
import "../hours.css";
import "./kiosk.css";

export const metadata = {
  title: "Scan-in Kiosk · Vantage",
  description:
    "Barcode / student-ID scan-in kiosk for the shop door — one big autofocused field, offline queueing when the Wi-Fi dies, and forgot-to-sign-out flags.",
};

export default function HoursKioskPage() {
  return <KioskClient />;
}
