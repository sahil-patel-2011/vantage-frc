"use client";
import { Button } from "../../../components/ui";

import { useState } from "react";

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
    const data = await response.json();
    setMessage(
      response.ok
        ? `${data.machineName} is paired. Return to the terminal to continue setup.`
        : data.error,
    );
  }

  return (
    <main className="module-page cad-pair-page">
      <form className="cad-pair-card" onSubmit={approve}>
        <div>
          <span className="breadcrumbs">CAD / Pair desktop</span>
          <h1>Approve this computer</h1>
          <p className="app-muted" style={{ margin: "8px 0 0" }}>
            Only approve a code shown on a computer you control. Your password is never entered in the terminal. Fusion
            jobs stay local — never hosted on Vercel.
          </p>
        </div>

        <label>
          Pairing code
          <small style={{ fontWeight: 500 }}>8–9 characters shown in your terminal (letters, numbers, dashes).</small>
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
            You aren&apos;t a member of any team yet — join or create one before pairing a device.
          </p>
        ) : (
          <label>
            Authorized organization
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
          <legend>CAD platform</legend>
          <label className="cad-choice" style={{ display: "grid", gridTemplateColumns: "20px 1fr" }}>
            <input
              type="radio"
              name="platform"
              checked={platform === "onshape"}
              onChange={() => setPlatform("onshape")}
            />
            <span>
              <strong>Onshape hosted</strong>
              <small style={{ display: "block", color: "var(--muted)", fontWeight: 500 }}>
                Server-run OAuth jobs; CLI monitors and diagnoses
              </small>
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
              <strong>Fusion 360 local</strong>
              <small style={{ display: "block", color: "var(--muted)", fontWeight: 500 }}>
                Relay runs only on this desktop with Fusion
              </small>
            </span>
          </label>
        </fieldset>

        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          <button className="primary-action" type="submit" disabled={!orgId || organizations.length === 0}>
            Approve pairing
          </button>
          {orgId ? (
            <Button as="a" variant="secondary" href={`/cad/setup?orgId=${encodeURIComponent(orgId)}`}>
              Setup wizard
            </Button>
          ) : null}
          {orgId ? (
            <Button as="a" variant="secondary" href={`/cad?orgId=${encodeURIComponent(orgId)}`}>
              CAD Builder
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
