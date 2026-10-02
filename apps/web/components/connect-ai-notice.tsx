import { aiConnectionHref } from "../lib/ai/connection";
import { Button } from "./ui";

export function ConnectAiNotice({ orgId }: { orgId?: string | null }) {
  return (
    <div className="connect-ai-notice" role="status">
      <div><strong>Connect AI to use the assistant</strong><p>Choose a connection. You can keep writing with templates.</p></div>
      <Button as="a" variant="secondary" href={aiConnectionHref(orgId)}>Connect AI</Button>
    </div>
  );
}
