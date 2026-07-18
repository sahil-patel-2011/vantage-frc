"use client";

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
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  async function approve(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/editor/pair/approve", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code, orgId }),
      });
      const data = (await response.json()) as { machineName?: string; error?: string };
      setMessage(
        response.ok
          ? `${data.machineName} is paired. Return to VS Code — the extension will finish automatically.`
          : (data.error ?? "Approval failed"),
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="auth-page">
      <form className="auth-card" onSubmit={(e) => void approve(e)}>
        <span className="eyebrow">VANTAGE / VS CODE PAIRING</span>
        <h1>Approve this editor</h1>
        <p>
          Only approve a code shown in an editor you control. Your password is never entered in VS Code. The extension
          will only send file or selection context when you opt in on each share.
        </p>
        <label>
          Pairing code
          <small>8–9 characters shown in the Vantage VS Code extension.</small>
          <input
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            pattern="[A-Z0-9-]{8,9}"
            required
          />
        </label>
        {organizations.length === 0 ? (
          <p>You aren&apos;t a member of any team yet — join or create one before pairing an editor.</p>
        ) : (
          <label>
            Organization / workspace
            <select value={orgId} onChange={(e) => setOrgId(e.target.value)} required>
              {organizations.map((org) => (
                <option value={org.id} key={org.id}>
                  {org.name} · {org.role}
                </option>
              ))}
            </select>
          </label>
        )}
        <button className="primary-action" disabled={busy || !organizations.length}>
          {busy ? "Approving…" : "Approve pairing"}
        </button>
        {message ? (
          <p role="status" className="auth-message">
            {message}
          </p>
        ) : null}
      </form>
    </main>
  );
}
