"use client";

import { useState } from "react";
import { EmptyState, FormGrid, FormRow, PageHeader } from "../../components/ui";

export default function ClaimWorkspaceClient() {
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [teamNumber, setTeamNumber] = useState("");
  const [error, setError] = useState("");
  const [orgId, setOrgId] = useState("");

  async function submit() {
    setError("");
    const response = await fetch("/api/organizations/claim", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name, slug, teamNumber: Number(teamNumber) }),
    });
    const data = (await response.json()) as { id?: string; error?: string };
    if (!response.ok || !data.id) {
      setError(data.error ?? "Could not claim this team.");
      return;
    }
    setOrgId(data.id);
  }

  return (
    <main className="module-page">
      <PageHeader
        title="Claim your FRC team"
        description="Verified accounts can create one workspace per unused TBA team number. Members still join by exact-email invite. STIMS remains official FIRST registration."
      />
      {orgId ? (
        <EmptyState
          title="Workspace created"
          description="Invite your scouts next. Import Notion or ICS from Bring your season."
        >
            <a className="app-button" href={`/migrate?orgId=${encodeURIComponent(orgId)}`}>
              Bring your season
            </a>
        </EmptyState>
      ) : (
        <FormGrid>
          <FormRow label="Team name">
            <input value={name} onChange={(event) => setName(event.target.value)} />
          </FormRow>
          <FormRow label="URL slug">
            <input value={slug} onChange={(event) => setSlug(event.target.value)} placeholder="cheesy-poofs" />
          </FormRow>
          <FormRow label="FRC team number">
            <input value={teamNumber} onChange={(event) => setTeamNumber(event.target.value)} inputMode="numeric" />
          </FormRow>
          {error ? <p className="app-muted">{error}</p> : null}
          <button type="button" className="app-button" onClick={() => void submit()}>
            Claim team
          </button>
        </FormGrid>
      )}
    </main>
  );
}
