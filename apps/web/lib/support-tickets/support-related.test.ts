import { describe, expect, it } from "vitest";
import {
  SUPPORT_RELATED_INCLUDE,
  summarizeSupportTickets,
  supportNextActions,
  supportRelatedLinks,
  supportStatusTone,
  ticketAwaitsReply,
} from "./support-related";
import type { SupportTicket } from "./types";

function ticket(partial: Partial<SupportTicket> & Pick<SupportTicket, "id" | "status">): SupportTicket {
  return {
    orgId: "org-1",
    userId: "user-1",
    subject: "Save fails",
    body: "Match scouting would not save.",
    adminResponse: null,
    adminUserId: null,
    respondedAt: null,
    createdAt: "2026-07-18T12:00:00.000Z",
    updatedAt: "2026-07-18T12:00:00.000Z",
    ...partial,
  };
}

describe("support Soft-UI helpers", () => {
  it("builds Account / Workspace / Notifications cross-links (Help optional)", () => {
    const links = supportRelatedLinks("org-1", { include: [...SUPPORT_RELATED_INCLUDE] });
    expect(links.map((l) => l.id)).toEqual(["account", "workspace", "notifications"]);
    expect(links.find((l) => l.id === "account")?.href).toBe("/account");
    expect(links.every((l) => !/demo/i.test(l.label))).toBe(true);
  });

  it("includes Help when requested — legacy alias path", () => {
    const links = supportRelatedLinks(null, { include: ["account", "help"] });
    expect(links.map((l) => l.id)).toEqual(["account", "help"]);
    expect(links.find((l) => l.id === "help")?.href).toBe("/help");
  });

  it("requires workspace before next actions", () => {
    const actions = supportNextActions({});
    expect(actions.map((a) => a.id)).toEqual(["workspace", "account", "help"]);
    expect(actions.every((a) => !/\bDEMO\b/.test(a.label))).toBe(true);
    expect(actions.some((a) => /DEMO|never pre-filled/i.test(a.detail))).toBe(true);
  });

  it("asks for first ticket when empty — never DEMO tickets", () => {
    const actions = supportNextActions({ orgId: "org-1", ticketCount: 0 });
    expect(actions[0]?.id).toBe("submit");
    expect(actions[0]?.primary).toBe(true);
    expect(actions.map((a) => a.id)).toContain("account");
    expect(actions.every((a) => !/\bDEMO\b/.test(a.label))).toBe(true);
    expect(actions.some((a) => /never DEMO/i.test(a.detail))).toBe(true);
  });

  it("summarizes only real tickets — empty stays zero", () => {
    expect(summarizeSupportTickets([])).toEqual({
      total: 0,
      open: 0,
      inProgress: 0,
      awaitingReply: 0,
      resolved: 0,
      closed: 0,
    });
    const summary = summarizeSupportTickets([
      ticket({ id: "1", status: "open" }),
      ticket({
        id: "2",
        status: "in_progress",
        adminResponse: "Looking into it",
        respondedAt: "2026-07-18T13:00:00.000Z",
      }),
      ticket({ id: "3", status: "resolved", adminResponse: "Fixed", respondedAt: "2026-07-18T14:00:00.000Z" }),
    ]);
    expect(summary.total).toBe(3);
    expect(summary.open).toBe(1);
    expect(summary.inProgress).toBe(1);
    expect(summary.awaitingReply).toBe(1);
    expect(summary.resolved).toBe(1);
  });

  it("detects awaiting reply only without a platform response", () => {
    expect(ticketAwaitsReply(ticket({ id: "a", status: "open" }))).toBe(true);
    expect(
      ticketAwaitsReply(
        ticket({ id: "b", status: "open", adminResponse: "Ack", respondedAt: "2026-07-18T13:00:00.000Z" }),
      ),
    ).toBe(false);
    expect(ticketAwaitsReply(ticket({ id: "c", status: "closed" }))).toBe(false);
  });

  it("maps status tones without DEMO", () => {
    expect(supportStatusTone("open")).toBe("setup");
    expect(supportStatusTone("resolved")).toBe("good");
    expect(supportStatusTone("closed")).toBe("");
  });
});
