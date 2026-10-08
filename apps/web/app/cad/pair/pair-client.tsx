"use client";

import { useRef, useState } from "react";
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
  initialPlatform = "fusion360",
  organizations,
}: {
  initialCode: string;
  initialPlatform?: "onshape" | "fusion360";
  organizations: Array<{ id: string; name: string; role: string }>;
}) {
  const [code, setCode] = useState(initialCode);
  const [orgId, setOrgId] = useState(organizations[0]?.id ?? "");
  const [platform, setPlatform] = useState(initialPlatform);
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);
  const [approved, setApproved] = useState(false);
  const submitting = useRef(false);

  async function approve(event: React.FormEvent) {
    event.preventDefault();
    if (submitting.current || approved) return;
    submitting.current = true;
    setPending(true);
    setMessage("");
    try {
      const response = await fetch("/api/cad/pair/approve", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code, orgId, platform }),
        signal: AbortSignal.timeout(20_000),
      });
      const data: unknown = await response.json().catch(() => null);
      const machineName =
        data && typeof data === "object" && "machineName" in data && typeof data.machineName === "string"
          ? data.machineName
          : "";
      const error =
        data && typeof data === "object" && "error" in data && typeof data.error === "string" ? data.error : "";
      const success = response.ok && data && typeof data === "object" && "success" in data && data.success === true;
      if (success) setApproved(true);
      setMessage(success
        ? machineName ? `${machineName} is paired. Return to your CAD client to continue.` : CAD_PAIR_APPROVED
        : error || "Pairing could not be confirmed. Check the code and try again.");
    } catch {
      setMessage("Pairing was not confirmed. Check your connection and check pairing in your CAD client before submitting again; the approval may have completed.");
    } finally {
      submitting.current = false;
      setPending(false);
    }
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
            disabled={pending || approved}
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
            <select value={orgId} onChange={(e) => setOrgId(e.target.value)} required disabled={pending || approved}>
              {organizations.map((org) => (
                <option value={org.id} key={org.id}>
                  {org.name} · {org.role}
                </option>
              ))}
            </select>
          </label>
        )}

        <fieldset disabled={pending || approved}>
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
            <Button variant="primary" type="submit" disabled={!orgId || pending || approved}>
              {approved ? "Paired" : pending ? "Pairing…" : "Approve pairing"}
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
