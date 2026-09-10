"use client";

import { useEffect, useState } from "react";
import { formatOrgLocation, type TeamBackgroundView } from "../../lib/team-background";

/** Soft team-settings editor for org city/state + short description (owners/admins). */
export function TeamProfilePanel({ orgId }: { orgId: string }) {
  const [view, setView] = useState<TeamBackgroundView | null>(null);
  const [city, setCity] = useState("");
  const [stateProv, setStateProv] = useState("");
  const [description, setDescription] = useState("");
  const [mission, setMission] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  async function load() {
    const response = await fetch(`/api/team/background?orgId=${encodeURIComponent(orgId)}`, {
      cache: "no-store",
    });
    const data = (await response.json()) as TeamBackgroundView & { error?: string };
    if (!response.ok) {
      setMessage(data.error ?? "Could not load team profile.");
      return;
    }
    setView(data);
    setCity(data.org.city ?? "");
    setStateProv(data.org.stateProv ?? "");
    setDescription(data.org.description ?? "");
    setMission(data.profile.mission ?? "");
    setMessage("");
  }

  useEffect(() => {
    void load();
  }, [orgId]);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!view?.canEdit) return;
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/team/background", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          orgId,
          city: city.trim() || null,
          stateProv: stateProv.trim() || null,
          description: description.trim() || null,
          mission: mission.trim() || null,
          history: view.profile.history,
          demographics: view.profile.demographics,
          achievements: view.profile.achievements,
          studentCount: view.profile.studentCount,
          mentorCount: view.profile.mentorCount,
          foundedYear: view.profile.foundedYear,
        }),
      });
      const data = (await response.json()) as TeamBackgroundView & { error?: string };
      if (!response.ok) {
        setMessage(data.error ?? "Could not save team profile.");
        return;
      }
      setView(data);
      setMessage("Team profile saved for this team.");
    } finally {
      setBusy(false);
    }
  }

  if (!view) {
    return (
      <section className="intel-panel" aria-busy>
        <span className="eyebrow">TEAM PROFILE</span>
        <p className="app-muted">Loading location and description…</p>
      </section>
    );
  }

  const locationLabel = formatOrgLocation(view.org.city, view.org.stateProv);

  return (
    <section className="intel-panel" aria-labelledby="team-profile-title">
      <span className="eyebrow">TEAM PROFILE · THIS WORKSPACE ONLY</span>
      <h2 id="team-profile-title" style={{ margin: "6px 0 4px", fontSize: "1.15rem" }}>
        Location &amp; description
      </h2>
      <p className="app-muted" style={{ marginTop: 0 }}>
        {locationLabel
          ? `Currently listed as ${locationLabel}.`
          : "Add city and state so sponsorship one-pagers know where your team is based."}{" "}
        Edit anytime; never shared across organizations.
      </p>

      {!view.canEdit ? (
        <p className="app-muted">{view.org.description?.trim() || "No team description yet."}</p>
      ) : (
        <form onSubmit={(event) => void save(event)} style={{ display: "grid", gap: "12px", marginTop: "12px" }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
            <label>
              City
              <input required maxLength={120} value={city} onChange={(e) => setCity(e.target.value)} placeholder="Portland" disabled={busy} />
            </label>
            <label>
              State / province
              <input required maxLength={80} value={stateProv} onChange={(e) => setStateProv(e.target.value)} placeholder="OR" disabled={busy} />
            </label>
          </div>
          <label>
            Describe the FRC team <small>Optional</small>
            <textarea maxLength={2000} rows={3} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Short blurb used in sponsorship value props and team background." disabled={busy} />
          </label>
          <label>
            Mission <small>Optional · sponsorship / grants</small>
            <textarea maxLength={2000} rows={2} value={mission} onChange={(e) => setMission(e.target.value)} placeholder="One or two sentences about what the team is about." disabled={busy} />
          </label>
          <button className="primary-action" type="submit" disabled={busy}>
            {busy ? "Saving…" : "Save team profile"}
          </button>
        </form>
      )}
      {message ? <p role="status" className="telemetry-status">{message}</p> : null}
    </section>
  );
}
