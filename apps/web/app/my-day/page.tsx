import MyDayClient from "./my-day-client";
import "./my-day.css";

export const metadata = {
  title: "My Day · Vantage",
  description: "Your next match, bumper color, partners, and opponents — glanceable on the field.",
};

export default function MyDayPage() {
  return <MyDayClient />;
}
