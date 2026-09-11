"use client";

import { useState } from "react";
import { Button } from "../../../components/ui";
import {
  CAD_PAIR_APPROVED,
  CAD_PAIR_DESCRIPTION,
  CAD_PAIR_FUSION,
  CAD_PAIR_ONSHAPE,
  CAD_PAIR_TITLE,
} from "../../../lib/cad/cad-setup-copy";

export default function PairClient({
  initialCode,
  organizations,
}: {
  initialCode: string;
  organizations: Array<{ id: string; name: string; role: string }>;
}) {
  const [code, setCode] = useState(initialCode);
  const [orgId, setOrgId] = useState(organizations[0]?.id ?? "");
  const [platform, setPlatform] = useState<"onshape" | "fusion360">("fusion360");
  const [message, setMessage] = useState("");

  async function approve(event: React.FormEvent) {
    event.preventDefault();
    const response = await fetch("/api/cad/pair/approve", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code, orgId, platform }),
    });
    const data: unknown = await response.json().catch(() => null);
    const machineName =
      data && typeof data === "object" && "machineName" in data && typeof data.machineName === "string"
        ? data.machineName
        : "";
    const error =
      data && typeof data === "object" && "error" in data && typeof data.error === "string" ? data.error : "";
    setMessage(response.ok ? (machineName ? `${machineName} is paired. Go back to the desktop app to continue.` : CAD_PAIR_APPROVED) : error);
  }

  return (
    <main className="module-page cad-pair-page">
      <form className="cad-pair-card" onSubmit={approve}>
        <div>
          <span className="breadcrumbs">CAD / Pair desktop</span>
          <h1>{CAD_PAIR_TITLE}</h1>
          <p className="app-muted" style={{ margin: "8px 0 0" }}>
            {CAD_PAIR_DESCRIPTION}
          </p>
        </div>

        <label>
          Pairing code
          <small style={{ fontWeight: 500 }}>8–9 characters shown on the computer you are pairing.</small>
          <input
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            pattern="[A-Z0-9-]{8,9}"
            required
            autoComplete="one-time-code"
          />
        </label>

        {organizations.length === 0 ? (
          <p className="telemetry-status" role="status">
            You aren&apos;t a member of any team yet — join or create one before pairing a computer.
          </p>
        ) : (
          <label>
            Team
            <select value={orgId} onChange={(e) => setOrgId(e.target.value)} required>
              {organizations.map((org) => (
                <option value={org.id} key={org.id}>
                  {org.name} · {org.role}
                </option>
              ))}
            </select>
          </label>
        )}

        <fieldset>
          <legend>What you design in</legend>
          <label className="cad-choice" style={{ display: "grid", gridTemplateColumns: "20px 1fr" }}>
            <input
              type="radio"
              name="platform"
              checked={platform === "onshape"}
              onChange={() => setPlatform("onshape")}
            />
            <span>
              <strong>Onshape</strong>
              <small style={{ display: "block", color: "var(--muted)", fontWeight: 500 }}>{CAD_PAIR_ONSHAPE}</small>
            </span>
          </label>
          <label className="cad-choice" style={{ display: "grid", gridTemplateColumns: "20px 1fr" }}>
            <input
              type="radio"
              name="platform"
              checked={platform === "fusion360"}
              onChange={() => setPlatform("fusion360")}
            />
            <span>
              <strong>Fusion on this computer</strong>
              <small style={{ display: "block", color: "var(--muted)", fontWeight: 500 }}>{CAD_PAIR_FUSION}</small>
            </span>
          </label>
        </fieldset>

        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          {organizations.length === 0 ? (
            <Button as="a" variant="primary" href="/workspace">
              Choose your team
            </Button>
          ) : (
            <Button variant="primary" type="submit" disabled={!orgId}>
              Approve pairing
            </Button>
          )}
          {orgId ? (
            <Button as="a" variant="secondary" href={`/cad/setup?orgId=${encodeURIComponent(orgId)}`}>
              CAD setup
            </Button>
          ) : null}
        </div>

        {message ? (
          <p role="status" className="telemetry-status">
            {message}
          </p>
        ) : null}
      </form>
    </main>
  );
}
