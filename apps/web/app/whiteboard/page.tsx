import WhiteboardClient from "./whiteboard-client";
import "./whiteboard.css";

export const metadata = {
  title: "Strategy Whiteboard",
  description: "Draw match plays over a field diagram, position robots, and save named strategies.",
};

export default function WhiteboardPage() {
  return <WhiteboardClient />;
}
