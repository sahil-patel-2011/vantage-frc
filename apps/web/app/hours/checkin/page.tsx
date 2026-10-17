import CheckinClient from "./checkin-client";
import "../hours.css";
import "../door/door.css";

export const metadata = {
  title: "Check in",
  description: "Checking you in or out from the shop door code.",
};

export default function HoursCheckinPage() {
  return <CheckinClient />;
}
