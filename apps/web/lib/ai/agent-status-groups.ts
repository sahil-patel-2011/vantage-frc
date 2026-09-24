import type { AiAgentStatus } from "./capabilities";

export type AgentStatusGroup = {
  status: AiAgentStatus["status"];
  /** The agents in this group, in the order they arrived. */
  agents: AiAgentStatus[];
  /** "Off" or "Paused" for a shared reason; null for the ready group. */
  verb: string | null;
  /** The shared reason, without any agent's name in front of it. */
  reason: string | null;
  setupHref: string | null;
};

/** Agent sentences read "<name> is off — <reason>" or "<name> is paused — <reason>". */
const SENTENCE = /^(.*?) is (off|paused) — (.+)$/;

function splitSentence(agent: AiAgentStatus): { verb: string; reason: string } | null {
  const match = SENTENCE.exec(agent.sentence);
  if (!match || match[1] !== agent.name) return null;
  const reason = match[3] ?? "";
  return { verb: match[2] === "paused" ? "Paused" : "Off", reason: reason.charAt(0).toUpperCase() + reason.slice(1) };
}

/**
 * Collapse agent rows that say the same thing. A team with no AI set up used to get eight
 * lines each ending "AI isn't provisioned for this team yet…", which buried the one line that
 * was different. Ready agents become one group; agents off for the same reason (and the same
 * fix) become one group; anything whose sentence doesn't split cleanly stays on its own.
 */
export function groupAgentStatuses(agents: readonly AiAgentStatus[]): AgentStatusGroup[] {
  const groups: AgentStatusGroup[] = [];
  const byKey = new Map<string, AgentStatusGroup>();
  for (const agent of agents) {
    if (agent.status === "ready") {
      let ready = byKey.get("ready");
      if (!ready) {
        ready = { status: "ready", agents: [], verb: null, reason: null, setupHref: null };
        byKey.set("ready", ready);
        groups.push(ready);
      }
      ready.agents.push(agent);
      continue;
    }
    const parts = splitSentence(agent);
    if (!parts) {
      groups.push({ status: agent.status, agents: [agent], verb: "Off", reason: agent.sentence, setupHref: agent.setupHref });
      continue;
    }
    const key = `off|${parts.verb}|${parts.reason}|${agent.setupHref ?? ""}`;
    const existing = byKey.get(key);
    if (existing) {
      existing.agents.push(agent);
      continue;
    }
    const group: AgentStatusGroup = {
      status: agent.status,
      agents: [agent],
      verb: parts.verb,
      reason: parts.reason,
      setupHref: agent.setupHref,
    };
    byKey.set(key, group);
    groups.push(group);
  }
  // What needs doing first, then what already works.
  return [...groups.filter((group) => group.status !== "ready"), ...groups.filter((group) => group.status === "ready")];
}

/** "Ask AI", "Ask AI and Strategy", "Ask AI, Strategy and CAD". */
export function listAgentNames(agents: readonly AiAgentStatus[]): string {
  const names = agents.map((agent) => agent.name);
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}
