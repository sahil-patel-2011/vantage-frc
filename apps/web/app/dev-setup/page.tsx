import DevSetupClient from "./dev-setup-client";
import "./dev-setup.css";

export const metadata = {
  title: "Programming setup",
  description:
    "Set up your laptop for FRC programming: Homebrew, Git, VS Code, WPILib, PathPlanner, GitHub and the Student Developer Pack, and how to use AI tools without shipping code you do not understand.",
};

export default function DevSetupPage() {
  return <DevSetupClient />;
}
