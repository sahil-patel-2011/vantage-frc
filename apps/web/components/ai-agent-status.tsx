"use client";

import { useEffect, useState } from "react";
import { groupAgentStatuses, listAgentNames } from "../lib/ai/agent-status-groups";
import type { AiAgentId, AiAgentStatus as AgentStatus } from "../lib/ai/capabilities";
import { withOrgHref } from "../lib/nav/product-nav";
import { Badge } from "./ui";
import "./ai-agent-status.css";

type Props = {
  orgId: string;
  /** Which agents to show, in order. Omit for all of them. */
  agents?: readonly AiAgentId[];
  /** Only list agents that cannot run (a surface that just needs the warnings). */
  unavailableOnly?: boolean;
  /** Section heading; omitted for an inline strip. */
  title?: string;
  className?: string;
};

type LoadState =
  | { kind: "loading" }
  | { kind: "ready"; agents: AgentStatus[] }
  | { kind: "error"; message: string };

/**
 * One line per AI agent: a Ready/Off badge, the plain-sentence reason, and a "Set up" link.
 *
 * Reads GET /api/ai/capabilities, which never reports an agent ready while something it needs is
 * missing. Shared by the Ask AI page and Team → AI keys; drop it on any AI surface.
 */
export function AiAgentStatus({ orgId, agents, unavailableOnly = false, title, className }: Props) {
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const filterKey = agents?.join(",") ?? "";

  useEffect(() => {
    let cancelled = false;
    setState({ kind: "loading" });
    fetch(`/api/ai/capabilities?orgId=${encodeURIComponent(orgId)}`, { cache: "no-store" })
      .then(async (response) => {
        const body = (await response.json().catch(() => ({}))) as { agents?: AgentStatus[]; error?: string };
        if (cancelled) return;
        if (!response.ok || !Array.isArray(body.agents)) {
          setState({ kind: "error", message: body.error ?? "Could not check AI status right now." });
          return;
        }
        setState({ kind: "ready", agents: body.agents });
      })
      .catch(() => {
        if (!cancelled) setState({ kind: "error", message: "Could not check AI status right now." });
      });
    return () => {
      cancelled = true;
    };
  }, [orgId]);

  if (state.kind === "loading") {
    return (
      <section className={`ai-agent-status is-loading ${className ?? ""}`} aria-busy="true" aria-label="AI status">
        <p className="ai-agent-status-note">Checking which AI tools are ready…</p>
      </section>
    );
  }
  if (state.kind === "error") {
    return (
      <section className={`ai-agent-status ${className ?? ""}`} aria-label="AI status">
        <p className="ai-agent-status-note" role="status">{state.message}</p>
      </section>
    );
  }

  const wanted = filterKey ? filterKey.split(",") : null;
  const rows = state.agents
    .filter((agent) => !wanted || wanted.includes(agent.id))
    .sort((a, b) => (wanted ? wanted.indexOf(a.id) - wanted.indexOf(b.id) : 0))
    .filter((agent) => !unavailableOnly || agent.status === "unavailable");
  if (!rows.length) return null;

  // One agent keeps its full sentence. Several agents with the same reason share one line.
  if (rows.length === 1 && rows[0]) {
    const agent = rows[0];
    return (
      <section className={`ai-agent-status ${className ?? ""}`} aria-label={title ?? "AI status"}>
        {title ? <h2 className="ai-agent-status-title">{title}</h2> : null}
        <ul className="ai-agent-status-list">
          <li className="ai-agent-status-row" data-status={agent.status} data-reason={agent.reason ?? ""}>
            <Badge tone={agent.status === "ready" ? "good" : "setup"}>{agent.status === "ready" ? "Ready" : "Off"}</Badge>
            <div className="ai-agent-status-body">
              <strong>{agent.name}</strong>
              <span>{agent.sentence}</span>
              {agent.writes && agent.writeNote ? <small>{agent.writeNote}</small> : null}
            </div>
            {agent.status === "unavailable" && agent.setupHref ? (
              <a className="app-button secondary ai-agent-status-setup" href={withOrgHref(agent.setupHref, orgId)}>
                Set up
                <span className="sr-only"> {agent.name}</span>
              </a>
            ) : null}
          </li>
        </ul>
      </section>
    );
  }

  const groups = groupAgentStatuses(rows);
  return (
    <section className={`ai-agent-status ${className ?? ""}`} aria-label={title ?? "AI status"}>
      {title ? <h2 className="ai-agent-status-title">{title}</h2> : null}
      <ul className="ai-agent-status-list">
        {groups.map((group) => {
          const names = listAgentNames(group.agents);
          const ready = group.status === "ready";
          return (
            <li
              key={group.agents.map((agent) => agent.id).join(",")}
              className="ai-agent-status-row"
              data-status={group.status}
              data-reason={group.agents[0]?.reason ?? ""}
            >
              <Badge tone={ready ? "good" : "setup"}>{ready ? "Ready" : (group.verb ?? "Off")}</Badge>
              <div className="ai-agent-status-body">
                <strong>{names}</strong>
                <span>{ready ? (group.agents.length === 1 ? (group.agents[0]?.sentence ?? "") : "Working now.") : group.reason}</span>
              </div>
              {!ready && group.setupHref ? (
                <a className="app-button secondary ai-agent-status-setup" href={withOrgHref(group.setupHref, orgId)}>
                  Set up
                  <span className="sr-only"> {names}</span>
                </a>
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
