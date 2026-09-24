import { describe, expect, it } from "vitest";
import type { AiAgentStatus } from "./capabilities";
import { groupAgentStatuses, listAgentNames } from "./agent-status-groups";

function agent(name: string, sentence: string, status: AiAgentStatus["status"] = "unavailable", setupHref: string | null = null) {
  return {
    id: name.toLowerCase().replace(/\s+/g, "_"),
    name,
    purpose: "",
    href: "/",
    status,
    reason: null,
    sentence,
    setupHref,
    setupLabel: null,
    tools: [],
    writes: false,
    writeNote: null,
  } as unknown as AiAgentStatus;
}

const NOT_PROVISIONED = "AI isn't provisioned for this team yet. Ask your Vantage admin to finish setting up the team.";

describe("groupAgentStatuses", () => {
  it("says a shared reason once, with every name it applies to", () => {
    const groups = groupAgentStatuses([
      agent("Ask AI", `Ask AI is off — ${NOT_PROVISIONED}`),
      agent("Strategy", `Strategy is off — ${NOT_PROVISIONED}`),
      agent("GitHub helper", "GitHub helper is off — GitHub isn't connected for this team. Connect it in Team admin.", "unavailable", "/team/admin"),
      agent("CAD", `CAD is off — ${NOT_PROVISIONED}`),
    ]);
    expect(groups).toHaveLength(2);
    expect(groups[0].reason).toBe(NOT_PROVISIONED);
    expect(listAgentNames(groups[0].agents)).toBe("Ask AI, Strategy and CAD");
    expect(groups[1].setupHref).toBe("/team/admin");
  });

  it("keeps ready agents together, after the ones that need work", () => {
    const groups = groupAgentStatuses([
      agent("Ask AI", "Ask AI is ready.", "ready"),
      agent("CAD", "CAD is paused — an owner turned on this team's AI kill switch. Turn it off in AI → Limits."),
      agent("Strategy", "Strategy is ready.", "ready"),
    ]);
    expect(groups.map((group) => group.status)).toEqual(["unavailable", "ready"]);
    expect(groups[0].verb).toBe("Paused");
    expect(groups[1].agents.map((a) => a.name)).toEqual(["Ask AI", "Strategy"]);
  });

  it("does not merge the same reason when the fix is different", () => {
    const groups = groupAgentStatuses([
      agent("A", "A is off — needs a key.", "unavailable", "/team/ai-keys"),
      agent("B", "B is off — needs a key.", "unavailable", "/connectors"),
    ]);
    expect(groups).toHaveLength(2);
  });

  it("leaves a sentence it can't split on its own line", () => {
    const groups = groupAgentStatuses([agent("A", "Something unusual happened.")]);
    expect(groups[0].reason).toBe("Something unusual happened.");
  });
});
