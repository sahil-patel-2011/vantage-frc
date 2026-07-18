"use client";

import { useEffect, useState } from "react";
import { EmptyState, PageHeader, Panel } from "../../../components/ui";
import { TeamOpsNav } from "../../../components/team-ops-nav";
import "./background.css";

type FormState = {
  city: string;
  stateProv: string;
  description: string;
  mission: string;
  history: string;
  demographics: string;
  achievements: string;
  studentCount: string;
  mentorCount: string;
  foundedYear: string;
};

const EMPTY: FormState = {
  city: "",
  stateProv: "",
  description: "",
  mission: "",
  history: "",
  demographics: "",
  achievements: "",
  studentCount: "",
  mentorCount: "",
  foundedYear: "",
};

export default function TeamBackgroundClient({ orgId }: { orgId: string }) {
  const [form, setForm] = useState<FormState>(EMPTY);
  const [canEdit, setCanEdit] = useState(false);
  const [seedWhoWeAre, setSeedWhoWeAre] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [orgName, setOrgName] = useState<string | null>(null);
  const [teamNumber, setTeamNumber] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [messageTone, setMessageTone] = useState<"ok" | "error">("ok");

  async function load() {
    setLoading(true);
    const response = await fetch(`/api/team/background?orgId=${encodeURIComponent(orgId)}`);
    const data = await response.json();
    if (!response.ok) {
      setMessage(data.error ?? "Could not load team background");
      setMessageTone("error");
      setLoading(false);
      return;
    }
    setCanEdit(Boolean(data.canEdit));
    setSeedWhoWeAre(typeof data.seedWhoWeAre === "string" ? data.seedWhoWeAre : null);
    setUpdatedAt(typeof data.updatedAt === "string" ? data.updatedAt : null);
    setOrgName(data.org?.orgName ?? null);
    setTeamNumber(data.org?.teamNumber ?? null);
    setForm({
      city: data.org?.city ?? "",
      stateProv: data.org?.stateProv ?? "",
      description: data.org?.description ?? "",
      mission: data.profile?.mission ?? "",
      history: data.profile?.history ?? "",
      demographics: data.profile?.demographics ?? "",
      achievements: Array.isArray(data.profile?.achievements)
        ? data.profile.achievements.join("\n")
        : "",
      studentCount: data.profile?.studentCount != null ? String(data.profile.studentCount) : "",
      mentorCount: data.profile?.mentorCount != null ? String(data.profile.mentorCount) : "",
      foundedYear: data.profile?.foundedYear != null ? String(data.profile.foundedYear) : "",
    });
    setMessage("");
    setLoading(false);
  }

  useEffect(() => {
    void load();
  }, [orgId]);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!canEdit || saving) return;
    setSaving(true);
    const response = await fetch("/api/team/background", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        orgId,
        city: form.city || null,
        stateProv: form.stateProv || null,
        description: form.description || null,
        mission: form.mission || null,
        history: form.history || null,
        demographics: form.demographics || null,
        achievements: form.achievements,
        studentCount: form.studentCount || null,
        mentorCount: form.mentorCount || null,
        foundedYear: form.foundedYear || null,
      }),
    });
    const data = await response.json();
    if (!response.ok) {
      setMessage(data.error ?? "Could not save team background");
      setMessageTone("error");
      setSaving(false);
      return;
    }
    setMessage("Team background saved for this workspace only.");
    setMessageTone("ok");
    setSaving(false);
    await load();
  }

  const set =
    (key: keyof FormState) =>
    (event: { target: { value: string } }) =>
      setForm((prev) => ({ ...prev, [key]: event.target.value }));

  const title =
    teamNumber != null ? `Team ${teamNumber} background` : orgName ? `${orgName} background` : "Team background";

  return (
    <main className="module-page team-background-page">
      <PageHeader
        breadcrumbs="Team / Background"
        title={title}
        description="Mission, history, demographics, and achievements used by sponsorship one-pagers and grant drafts. Owners and admins edit this workspace only — never imported from another team."
      />
      <TeamOpsNav orgId={orgId} active="admin" />

      <nav className="settings-inline-links" aria-label="Related team settings">
        <a href={`/team/admin?orgId=${encodeURIComponent(orgId)}`}>Team admin</a>
        <a href={`/writer?orgId=${encodeURIComponent(orgId)}`}>Award writer</a>
        <a href={`/team/grants?orgId=${encodeURIComponent(orgId)}`}>Grants</a>
        <a href={`/team/sponsors?orgId=${encodeURIComponent(orgId)}`}>Sponsors</a>
      </nav>

      {message ? (
        <p className={messageTone === "error" ? "status-bad" : "status-good"} role="status">
          {message}
        </p>
      ) : null}

      {loading ? (
        <EmptyState soft title="Loading team background" description="Pulling this workspace’s profile…" />
      ) : (
        <form className="team-background-form" onSubmit={(event) => void save(event)}>
          <Panel>
            <h2>Location &amp; short description</h2>
            <p className="app-muted team-background-hint">
              City and state come from team onboarding when present. Edit them here anytime — they stay on this organization only.
            </p>
            <div className="team-background-grid">
              <label>
                City
                <input value={form.city} onChange={set("city")} disabled={!canEdit} placeholder="Portland" maxLength={120} />
              </label>
              <label>
                State / province
                <input value={form.stateProv} onChange={set("stateProv")} disabled={!canEdit} placeholder="OR" maxLength={80} />
              </label>
            </div>
            <label>
              Team description
              <textarea
                value={form.description}
                onChange={set("description")}
                disabled={!canEdit}
                rows={3}
                maxLength={2000}
                placeholder="One short paragraph about who this FRC team is."
              />
              <small>Optional. Used as a fallback blurb for sponsor proposals.</small>
            </label>
          </Panel>

          <Panel>
            <h2>Mission &amp; history</h2>
            <label>
              Mission
              <textarea
                value={form.mission}
                onChange={set("mission")}
                disabled={!canEdit}
                rows={3}
                maxLength={2000}
                placeholder="1–3 sentences: what this team exists to do."
              />
            </label>
            <label>
              History
              <textarea
                value={form.history}
                onChange={set("history")}
                disabled={!canEdit}
                rows={5}
                maxLength={8000}
                placeholder="Origin story, milestones, how the program grew — facts from this team only."
              />
            </label>
          </Panel>

          <Panel>
            <h2>Demographics</h2>
            <div className="team-background-grid">
              <label>
                Students
                <input
                  type="number"
                  min={0}
                  value={form.studentCount}
                  onChange={set("studentCount")}
                  disabled={!canEdit}
                  placeholder="40"
                />
              </label>
              <label>
                Mentors
                <input
                  type="number"
                  min={0}
                  value={form.mentorCount}
                  onChange={set("mentorCount")}
                  disabled={!canEdit}
                  placeholder="8"
                />
              </label>
              <label>
                Founded year
                <input
                  type="number"
                  min={1992}
                  max={3000}
                  value={form.foundedYear}
                  onChange={set("foundedYear")}
                  disabled={!canEdit}
                  placeholder="2012"
                />
              </label>
            </div>
            <label>
              Demographics notes
              <textarea
                value={form.demographics}
                onChange={set("demographics")}
                disabled={!canEdit}
                rows={3}
                maxLength={4000}
                placeholder="Schools served, first-gen STEM share, Title I context — only what you are comfortable publishing."
              />
            </label>
          </Panel>

          <Panel>
            <h2>Achievements</h2>
            <label>
              Key achievements
              <textarea
                value={form.achievements}
                onChange={set("achievements")}
                disabled={!canEdit}
                rows={5}
                placeholder={"won our regional\nlogged 400 outreach hours\ngrew to 40 students"}
              />
              <small>One per line. Used by the award writer and sponsorship drafts for this org only.</small>
            </label>
          </Panel>

          {seedWhoWeAre ? (
            <Panel>
              <h2>Sponsor proposal preview seed</h2>
              <p className="app-muted team-background-hint">
                Draft “who we are” text assembled from this workspace’s fields. Nothing is copied from another team.
              </p>
              <pre className="team-background-seed">{seedWhoWeAre}</pre>
            </Panel>
          ) : null}

          <div className="team-background-actions">
            {canEdit ? (
              <button type="submit" className="app-button" disabled={saving}>
                {saving ? "Saving…" : "Save team background"}
              </button>
            ) : (
              <p className="app-muted">View only — ask an owner or admin to edit this profile.</p>
            )}
            {updatedAt ? (
              <small className="app-muted">Last updated {new Date(updatedAt).toLocaleString()}</small>
            ) : null}
          </div>
        </form>
      )}
    </main>
  );
}
