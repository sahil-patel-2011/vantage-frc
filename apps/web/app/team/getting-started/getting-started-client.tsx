"use client";

import { useEffect, useState } from "react";
import { PageHeader } from "../../../components/ui/page-header";
import { TeamOpsNav } from "../../../components/team-ops-nav";
import { withOrgHref } from "../../../lib/nav/product-nav";
import { surfaceOnboardingLinks } from "../../../lib/onboarding-workflow";

type Signals = {
  members: number;
  pendingInvites: number;
  knowledgeChars: number;
  teamMemories: number;
  alumni: number;
  assistantRuns: number;
  budgetsConfigured: boolean | null;
  discordConnected: boolean | null;
  joinedSubteam: boolean;
  logisticsTrips: number;
  kickoffActions: number;
  hasLocation?: boolean;
};

type Data = {
  role: string;
  isAdmin: boolean;
  teamNumber: number | null;
  orgName: string;
  signals: Signals;
};

type Task = {
  title: string;
  detail: string;
  done: boolean;
  href: string;
  cta: string;
  adminOnly?: boolean;
};

function buildTasks(data: Data, orgId: string): Task[] {
  const s = data.signals;
  const q = `?orgId=${orgId}`;
  return [
    {
      title: "Add team location",
      detail:
        s.hasLocation === true
          ? "City and state are on the org profile for sponsorships and partners."
          : "Owners/admins: add city and state so one-pagers know where you compete from.",
      done: s.hasLocation === true,
      href: `/team${q}`,
      cta: "Set location",
      adminOnly: true,
    },
    {
      title: "Invite your team",
      detail:
        s.members > 1
          ? `${s.members} members on board${s.pendingInvites ? `, ${s.pendingInvites} invite(s) pending` : ""}.`
          : "Invite mentors and students by their exact email.",
      done: s.members > 1,
      href: `/team${q}`,
      cta: "Invite members",
      adminOnly: true,
    },
    {
      title: "Join a subteam calendar",
      detail: s.joinedSubteam
        ? "You're on at least one subteam — practices and build sessions will show up."
        : "Pick mechanical, software, or your build crew so the right calendar events appear.",
      done: s.joinedSubteam,
      href: `/team/calendar${q}`,
      cta: "Open calendar",
    },
    {
      title: "Write your Team Knowledge",
      detail:
        s.knowledgeChars > 0
          ? `${s.knowledgeChars.toLocaleString()} characters — the AI reads this on every team chat.`
          : "Add robot, strategy, and conventions so the AI knows your team from turn one.",
      done: s.knowledgeChars > 100,
      href: `/team/knowledge${q}`,
      cta: "Edit knowledge",
    },
    {
      title: "Check event logistics",
      detail:
        s.logisticsTrips > 0
          ? `${s.logisticsTrips} trip(s) on file — lodging, travel notes, day-of lists.`
          : "Mentors add hotels and travel checklists here before competition.",
      done: s.logisticsTrips > 0,
      href: `/logistics${q}`,
      cta: "Open logistics",
    },
    {
      title: "Open kickoff summary",
      detail:
        s.kickoffActions > 0
          ? `${s.kickoffActions} scoring action(s) captured — keep priorities current.`
          : "Structure the game: scoring value, design priorities, CAD brief handoff.",
      done: s.kickoffActions > 0,
      href: `/kickoff${q}`,
      cta: "Open kickoff",
    },
    {
      title: "Try the assistant",
      detail:
        s.assistantRuns > 0
          ? `${s.assistantRuns} assistant run(s) so far.`
          : "Ask it something real: draft an auto strategy or what should we scout.",
      done: s.assistantRuns > 0,
      href: `/chat${q}`,
      cta: "Open assistant",
    },
    {
      title: "Set AI budgets",
      detail:
        s.budgetsConfigured == null
          ? "An admin sets hard spend and token limits before anything runs up a bill."
          : s.budgetsConfigured
            ? "Budget controls are configured."
            : "Set hard spend/token limits so AI never surprises you.",
      done: s.budgetsConfigured === true,
      href: `/team/budgets${q}`,
      cta: "Set budgets",
      adminOnly: true,
    },
    {
      title: "Start your alumni network",
      detail:
        s.alumni > 0
          ? `${s.alumni} alum(s) in the network.`
          : "Keep grads connected — add alumni and connect your Discord.",
      done: s.alumni > 0,
      href: `/team/alumni${q}`,
      cta: "Add alumni",
    },
    {
      title: "Connect Discord",
      detail:
        s.discordConnected == null
          ? "An admin can link your Discord to broadcast alumni-network announcements."
          : s.discordConnected
            ? "Discord is connected."
            : "Link a channel webhook to post announcements to your server.",
      done: s.discordConnected === true,
      href: `/team/alumni${q}`,
      cta: "Connect Discord",
      adminOnly: true,
    },
  ];
}

export default function GettingStartedClient({ orgId }: { orgId: string }) {
  const [data, setData] = useState<Data | null>(null);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    async function load() {
      setLoading(true);
      const response = await fetch(`/api/team/getting-started?orgId=${orgId}`);
      const body = await response.json();
      if (!active) return;
      if (!response.ok) setMessage(body.error ?? "Unable to load getting-started");
      else {
        setMessage("");
        setData(body);
      }
      setLoading(false);
    }
    void load();
    return () => {
      active = false;
    };
  }, [orgId]);

  const tasks = data ? buildTasks(data, orgId).filter((t) => data.isAdmin || !t.adminOnly) : [];
  const done = tasks.filter((t) => t.done).length;
  const pct = tasks.length ? Math.round((done / tasks.length) * 100) : 0;
  const crossLinks = surfaceOnboardingLinks("getting_started", orgId);

  return (
    <main className="module-page start-page getting-started-page">
      <PageHeader
        navPath="/team/getting-started"
        title={data ? `Team setup · ${data.orgName}` : "Team setup"}
        description="Org-wide workspace checklist — invites, knowledge, budgets. For your personal role path, open Your path."
      >
        <div className="start-actions">
          <a className="start-btn primary" href={withOrgHref("/start", orgId)}>
            Your path
          </a>
          {crossLinks.map((link) => (
            <a key={link.href} className="start-btn" href={link.href}>
              {link.label}
            </a>
          ))}
        </div>
      </PageHeader>

      <TeamOpsNav orgId={orgId} />

      {message ? (
        <p className="start-warn" role="status">
          {message}
        </p>
      ) : null}
      {loading ? <p className="start-meta">Loading…</p> : null}

      {!loading && data ? (
        <>
          <section className="start-progress" aria-label="Setup progress">
            <strong>
              {done}/{tasks.length} done · {pct}%
            </strong>
            <div className="start-progress-bar">
              <span style={{ width: `${pct}%` }} />
            </div>
          </section>

          <ul className="start-checks">
            {tasks.map((task) => (
              <li key={task.title} className={`start-check${task.done ? " done" : ""}`}>
                <span aria-hidden="true">{task.done ? "✓" : "○"}</span>
                <div>
                  <strong>{task.title}</strong>
                  <span>{task.detail}</span>
                </div>
                <a href={task.href}>{task.done ? "Review" : task.cta}</a>
              </li>
            ))}
          </ul>

          <section className="start-empty">
            <p>
              <strong>Getting great answers from the AI</strong> — 1 · Give it context (Team Knowledge does
              this). 2 · Say what you want to do. 3 · Describe the result you expect.
            </p>
          </section>
        </>
      ) : null}
    </main>
  );
}
