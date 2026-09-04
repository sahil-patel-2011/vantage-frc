"use client";

import dynamic from "next/dynamic";
import "./ask-canvas.css";

const ChatClient = dynamic(() => import("../chat/chat-client"), { ssr: false });
const WriterClient = dynamic(() => import("../writer/writer-client"), { ssr: false });
const AutonomousAgentPanel = dynamic(
  () => import("./autonomous-agent-panel").then((m) => m.AutonomousAgentPanel),
  { ssr: false },
);

const MODES = [
  { id: "chat", label: "Ask" },
  { id: "writer", label: "Write" },
  { id: "agent", label: "Agent" },
] as const;

export type AskMode = (typeof MODES)[number]["id"];

export function AskCanvas({
  orgId,
  mode,
  onMode,
}: {
  orgId: string;
  mode: AskMode;
  onMode: (tab: string) => void;
}) {
  return (
    <div className="ask-canvas">
      <div className="ask-modes" role="tablist" aria-label="Assistant mode">
        {MODES.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={mode === item.id}
            className={mode === item.id ? "is-active" : undefined}
            onClick={() => onMode(item.id)}
          >
            {item.label}
          </button>
        ))}
      </div>
      <div className="ask-canvas-body" data-mode={mode}>
        {mode === "chat" ? (
          <ChatClient orgId={orgId} initialPrompt="" source="" contextId="" embedded />
        ) : null}
        {mode === "writer" ? <WriterClient orgId={orgId} embedded /> : null}
        {mode === "agent" ? <AutonomousAgentPanel orgId={orgId} embedded /> : null}
      </div>
    </div>
  );
}
