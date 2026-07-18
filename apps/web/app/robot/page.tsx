import RobotClient from "./robot-client";
import "./robot.css";

export const metadata = {
  title: "Robot Blueprint · Vantage",
  description: "The robot's digital twin — every subsystem linked to its CAD, code, strategy priority, and live ops data.",
};

export default function RobotPage() {
  return <RobotClient />;
}
