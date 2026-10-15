"use client";

import { Button } from "../../components/ui";
import { withOrgHref } from "../../lib/nav/product-nav";
import { connectionMessage, connectionNextStep, type AiConnection } from "./use-ai-connection";

export const CONNECTION_NOTE_ID = "ch-ai-connection-note";

/**
 * What the composer says before anyone types when AI can't answer: the reason and the one thing
 * to do about it. Send stays disabled (flat, muted) and is described by this note, so the action
 * here is the only button that does anything — the way Apple shows a disabled button with its
 * reason beside it.
 */
export function ConnectionNote({ orgId, connection, connectionHref, onConnect, onRetry }: {
  orgId: string;
  /** null while the check is running. */
  connection: AiConnection | null;
  connectionHref: string;
  onConnect: () => void;
  onRetry: () => void;
}) {
  if (!orgId) return null;
  if (!connection) {
    return <p id={CONNECTION_NOTE_ID} className="ch-composer-note" role="status">Checking your AI connection…</p>;
  }
  if (connection.configured !== false) return null;
  const step = connectionNextStep(connection);
  return (
    <div id={CONNECTION_NOTE_ID} className="ch-connection-note" role="status">
      <p>{connectionMessage(connection)}</p>
      {step === "connect" ? (
        <Button variant="primary" size="sm" type="button" onClick={onConnect}>Connect AI</Button>
      ) : step === "team" ? (
        <Button as="a" variant="primary" size="sm" href={withOrgHref("/team/ai-keys", orgId)}>Connect AI for the team</Button>
      ) : step === "ask_owner" ? (
        <p className="ch-connection-hint">Ask a team owner or admin to connect AI.</p>
      ) : step === "settings" ? (
        <Button as="a" variant="secondary" size="sm" href={connectionHref}>Check AI settings</Button>
      ) : step === "retry" ? (
        <Button variant="secondary" size="sm" type="button" onClick={onRetry}>Retry check</Button>
      ) : null}
    </div>
  );
}
