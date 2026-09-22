"use client";

import { useCallback, useEffect, useState } from "react";
import { Badge, Button } from "./ui";
import "./ai-action-proposals.css";

type Proposal = {
  id: string;
  toolName: string;
  kind: string;
  summary: string;
  status: string;
  proposedByName: string;
  createdAt: string;
  canDecide: boolean;
  href: string | null;
};

type Props = {
  orgId: string;
  /** Change it (e.g. the message count) to re-check after each AI turn. */
  refreshKey?: number | string;
};

/**
 * "Proposed by AI — Confirm / Discard" cards for AI write actions (purchase requests, CAD
 * briefs). Nothing changes until someone presses Confirm; the write then runs as that person,
 * with their own permissions, and is recorded in the proposal audit trail.
 */
export function AiActionProposals({ orgId, refreshKey }: Props) {
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ tone: "good" | "error"; text: string; href?: string | null } | null>(null);

  const load = useCallback(async () => {
    try {
      const response = await fetch(`/api/ai/proposals?orgId=${encodeURIComponent(orgId)}`, { cache: "no-store" });
      if (!response.ok) {
        setProposals([]);
        return;
      }
      const body = (await response.json()) as { proposals?: Proposal[] };
      setProposals(Array.isArray(body.proposals) ? body.proposals : []);
    } catch {
      setProposals([]);
    }
  }, [orgId]);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  async function decide(proposal: Proposal, decision: "confirm" | "discard") {
    setBusyId(proposal.id);
    setNotice(null);
    try {
      const response = await fetch("/api/ai/proposals", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ orgId, proposalId: proposal.id, decision }),
      });
      const body = (await response.json().catch(() => ({}))) as {
        status?: string;
        error?: string | null;
        href?: string | null;
      };
      if (body.status === "confirmed") {
        setNotice({ tone: "good", text: `Done: ${proposal.summary}.`, href: body.href ?? proposal.href });
      } else if (body.status === "discarded") {
        setNotice({ tone: "good", text: "Discarded — nothing was changed." });
      } else {
        setNotice({ tone: "error", text: body.error ?? "That did not go through. Nothing was changed." });
      }
    } catch {
      setNotice({ tone: "error", text: "Could not reach Vantage. Nothing was changed." });
    } finally {
      setBusyId(null);
      await load();
    }
  }

  if (!proposals.length && !notice) return null;

  return (
    <section className="ai-proposals" aria-label="Actions proposed by AI">
      {proposals.map((proposal) => (
        <article key={proposal.id} className="ai-proposal">
          <header>
            <Badge tone="info">Proposed by AI</Badge>
            <span className="ai-proposal-kind">{proposal.kind}</span>
            {proposal.proposedByName !== "You" ? (
              <span className="ai-proposal-for">for {proposal.proposedByName}</span>
            ) : null}
          </header>
          <p className="ai-proposal-summary">{proposal.summary}</p>
          <p className="ai-proposal-note">Nothing has changed yet. Confirm to do it as you, or discard it.</p>
          {proposal.canDecide ? (
            <div className="ai-proposal-actions">
              <Button
                variant="primary"
                type="button"
                disabled={busyId === proposal.id}
                onClick={() => void decide(proposal, "confirm")}
              >
                {busyId === proposal.id ? "Working…" : "Confirm"}
              </Button>
              <Button
                variant="secondary"
                type="button"
                disabled={busyId === proposal.id}
                onClick={() => void decide(proposal, "discard")}
              >
                Discard
              </Button>
            </div>
          ) : (
            <p className="ai-proposal-note">Only the person who asked, or a team owner or admin, can confirm this.</p>
          )}
        </article>
      ))}
      {notice ? (
        <p className={`ai-proposal-notice is-${notice.tone}`} role="status">
          {notice.text}{" "}
          {notice.href ? <a href={notice.href}>Open it</a> : null}
        </p>
      ) : null}
    </section>
  );
}
