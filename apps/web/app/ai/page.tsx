import dynamic from "next/dynamic";

const AiHub = dynamic(() => import("./ai-hub"));

export const metadata = {
  title: "AI",
  description:
    "Chat, spend limits, writing help, code assist, and team memory.",
};

export default function AiPage() {
  return <AiHub />;
}
