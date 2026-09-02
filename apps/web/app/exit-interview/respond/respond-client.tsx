"use client";

// Public self-serve exit interview form. The invitee has no session (they may
// already have lost team access), so everything is keyed off the one-time link.
import { useEffect, useState } from "react";
import { exitInterviewRoleLabel } from "../../../lib/exit-interview";
import { EXIT_INTERVIEW_RESPOND_API, type ExitInviteState } from "../../../lib/exit-interview/invite-shared";
import type { ExitInterviewRole } from "../../../lib/exit-interview/types";

const ROLES: ExitInterviewRole[] = [
  "mechanical",
  "electrical",
  "programming",
  "strategy",
  "outreach",
  "leadership",
  "mentor",
  "other",
];

type Phase = "loading" | "invalid" | "unavailable" | "ready" | "submitting" | "done";

export default function RespondClient({ token }: { token: string }) {
  const [phase, setPhase] = useState<Phase>(token ? "loading" : "invalid");
  const [state, setState] = useState<ExitInviteState | null>(null);
  const [error, setError] = useState("");
  const [form, setForm] = useState({
    role: "other" as ExitInterviewRole,
    yearsOnTeam: "",
    graduationYear: "",
    highlights: "",
    adviceForFuture: "",
    skillsToDocument: "",
    contactEmail: "",
    willingToMentor: false,
  });

  useEffect(() => {
    if (!token) return;
    void fetch(`${EXIT_INTERVIEW_RESPOND_API}?token=${encodeURIComponent(token)}`)
      .then(async (response) => {
        if (response.status === 404) {
          setPhase("invalid");
          return;
        }
        const data = (await response.json()) as ExitInviteState | { error?: string };
        if (!response.ok || !("status" in data)) {
          setPhase("unavailable");
          return;
        }
        setState(data);
        if (data.status === "open") {
          setForm((prev) => ({ ...prev, graduationYear: String(data.seasonYear) }));
        }
        setPhase("ready");
      })
      .catch(() => setPhase("unavailable"));
  }, [token]);

  const set = (key: keyof typeof form) => (event: { target: { value: string } }) =>
    setForm((prev) => ({ ...prev, [key]: event.target.value }));

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (phase !== "ready") return;
    setPhase("submitting");
    setError("");
    try {
      const response = await fetch(EXIT_INTERVIEW_RESPOND_API, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          token,
          role: form.role,
          yearsOnTeam: Number(form.yearsOnTeam) || 0,
          graduationYear: Number(form.graduationYear) || undefined,
          highlights: form.highlights || undefined,
          adviceForFuture: form.adviceForFuture || undefined,
          skillsToDocument: form.skillsToDocument || undefined,
          contactEmail: form.contactEmail || undefined,
          willingToMentor: form.willingToMentor,
        }),
      });
      const data = (await response.json()) as { ok?: boolean; error?: string };
      if (!response.ok) {
        setError(data.error ?? "Could not save your answers.");
        setPhase(response.status === 410 || response.status === 409 ? "invalid" : "ready");
        return;
      }
      setPhase("done");
    } catch {
      setError("Network error — your answers were not saved. Try again.");
      setPhase("ready");
    }
  }

  const shell = (children: React.ReactNode) => (
    <main className="module-page" style={{ maxWidth: 720, margin: "0 auto", padding: "24px 16px" }}>
      {children}
    </main>
  );

  if (phase === "loading") return shell(<p className="app-muted">Checking your link…</p>);
  if (phase === "invalid" || state?.status === "used" || state?.status === "expired") {
    const title =
      state?.status === "used"
        ? "This exit interview has already been submitted"
        : state?.status === "expired"
          ? "This link has expired"
          : "This link is not valid";
    return shell(
      <section className="app-card soft-panel">
        <h1 style={{ marginTop: 0 }}>{title}</h1>
        <p className="app-muted">
          {error || "It may have been used, turned off, or expired. Ask a team mentor for a fresh link."}
        </p>
      </section>,
    );
  }
  if (phase === "unavailable") {
    return shell(
      <section className="app-card soft-panel">
        <h1 style={{ marginTop: 0 }}>Try again later</h1>
        <p className="app-muted">The team&apos;s database is unavailable right now. Your link is still valid.</p>
      </section>,
    );
  }
  if (phase === "done" && state?.status === "open") {
    return shell(
      <section className="app-card soft-panel">
        <h1 style={{ marginTop: 0 }}>Thank you, {state.memberName}</h1>
        <p className="app-muted">
          Your exit interview is saved for {state.orgName}
          {state.teamNumber ? ` (Team ${state.teamNumber})` : ""} and will become part of the team&apos;s season
          handoff. This link is now closed.
        </p>
      </section>,
    );
  }
  if (state?.status !== "open") return shell(<p className="app-muted">Loading…</p>);

  const busy = phase === "submitting";
  return shell(
    <form className="app-card soft-panel" onSubmit={submit} style={{ display: "grid", gap: 12 }}>
      <div>
        <span className="app-badge demo">
          {state.orgName}
          {state.teamNumber ? ` · Team ${state.teamNumber}` : ""}
        </span>
        <h1 style={{ margin: "8px 0 4px" }}>Exit interview — {state.memberName}</h1>
        <p className="app-muted" style={{ margin: 0 }}>
          Season {state.seasonYear}. What you write here becomes the team&apos;s season-handoff page for future
          members. Every field is optional, but share at least one thought.
        </p>
      </div>

      {error ? (
        <p className="telemetry-status" role="alert">
          {error}
        </p>
      ) : null}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 10 }}>
        <label style={{ display: "grid", gap: 4 }}>
          <span className="app-muted">Primary role</span>
          <select value={form.role} disabled={busy} onChange={set("role")}>
            {ROLES.map((role) => (
              <option key={role} value={role}>
                {exitInterviewRoleLabel(role)}
              </option>
            ))}
          </select>
        </label>
        <label style={{ display: "grid", gap: 4 }}>
          <span className="app-muted">Years on team</span>
          <input type="number" min={0} max={20} value={form.yearsOnTeam} disabled={busy} onChange={set("yearsOnTeam")} />
        </label>
        <label style={{ display: "grid", gap: 4 }}>
          <span className="app-muted">Graduation year</span>
          <input type="number" min={2000} max={2999} value={form.graduationYear} disabled={busy} onChange={set("graduationYear")} />
        </label>
      </div>
      <label style={{ display: "grid", gap: 4 }}>
        <span className="app-muted">Highlights — what are you proud of?</span>
        <textarea rows={3} value={form.highlights} disabled={busy} onChange={set("highlights")} />
      </label>
      <label style={{ display: "grid", gap: 4 }}>
        <span className="app-muted">Advice for future members</span>
        <textarea rows={3} value={form.adviceForFuture} disabled={busy} onChange={set("adviceForFuture")} />
      </label>
      <label style={{ display: "grid", gap: 4 }}>
        <span className="app-muted">Skills or knowledge worth documenting before you go</span>
        <textarea rows={3} value={form.skillsToDocument} disabled={busy} onChange={set("skillsToDocument")} />
      </label>
      <label style={{ display: "grid", gap: 4 }}>
        <span className="app-muted">Contact email (optional — for alumni outreach)</span>
        <input type="email" value={form.contactEmail} disabled={busy} onChange={set("contactEmail")} />
      </label>
      <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
        <input
          type="checkbox"
          checked={form.willingToMentor}
          disabled={busy}
          onChange={(event) => setForm((prev) => ({ ...prev, willingToMentor: event.target.checked }))}
        />
        I&apos;m willing to mentor future members
      </label>
      <div>
        <button type="submit" className="app-button" disabled={busy}>
          {busy ? "Saving…" : "Submit exit interview"}
        </button>
      </div>
    </form>,
  );
}
