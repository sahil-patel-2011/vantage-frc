import RobotClient from "./robot-client";
import "./robot.css";

export const metadata = {
  title: "Robot Blueprint",
  description: "Every part of the robot, each linked to its CAD, code, strategy priority, and live shop data.",
};

export default function RobotPage() {
  return <RobotClient />;
}
