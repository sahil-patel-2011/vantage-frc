"use client";

import { useState } from "react";
import { Button, Modal } from "../../components/ui";
import { writeStoredBoardId } from "../../lib/dashboard/boards";
import type { BoardMeta, BoardState } from "../dashboard/dashboard-board-types";
import { fetchProductSession } from "../../lib/nav/product-session";
import { getFeatureSnapshot, putFeatureSnapshot } from "../../lib/offline/feature-cache";
import { dashboardCacheAfterSave, isDashboardOfflineCache, type DashboardOfflineCache } from "../dashboard/dashboard-offline-cache";

export function HomeDefaultsPanel({ orgId }: { orgId: string | null }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  async function reset() {
    if (!orgId) return;
    setBusy(true); setError("");
    try {
      const [response, session] = await Promise.all([
        fetch(`/api/dashboards?orgId=${encodeURIComponent(orgId)}`, { cache: "no-store" }), fetchProductSession(orgId),
      ]);
      if (!response.ok) throw new Error("Could not load your Home. Try again.");
      if (!session?.userId) throw new Error("Sign in again to reset Home.");
      const current = await response.json() as { active: BoardState; boards: BoardMeta[] };
      const target = current.active?.scope === "personal" && current.active.id ? current.active : current.boards.find(board => board.scope === "personal");
      const write = await fetch("/api/dashboards", { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ orgId, action: target ? "reset" : "create", id: target?.id, scope: "personal", name: "My Home", activate: true }) });
      const result = await write.json() as BoardState & { error?: string };
      if (!write.ok || !result.id || !Array.isArray(result.layout)) throw new Error(result.error ?? "Could not reset Home. Try again.");
      writeStoredBoardId(orgId, session.userId, result.id);
      try {
        const cached = await getFeatureSnapshot<DashboardOfflineCache>("dashboard", orgId);
        if (cached?.data && isDashboardOfflineCache(cached.data)) {
          await putFeatureSnapshot("dashboard", orgId, dashboardCacheAfterSave(cached.data, result));
        }
      } catch { /* The server has restored Home even if device storage is unavailable. */ }
      setSaved(true); setOpen(false);
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Could not reset Home. Check your connection and try again."); }
    finally { setBusy(false); }
  }
  return <section className="home-defaults-panel" aria-labelledby="home-defaults-title">
    <div><h2 id="home-defaults-title">Home dashboard</h2><p>Restore the standard cards and sizes for your personal Home.</p></div>
    <Button type="button" disabled={!orgId || busy} onClick={() => { setError(""); setOpen(true); }}>Reset Home to default</Button>
    {saved ? <p role="status">Home reset. <a href={`/dashboard?orgId=${encodeURIComponent(orgId ?? "")}`}>Open Home</a></p> : null}
    <Modal open={open} onClose={() => { if (!busy) setOpen(false); }} title="Reset Home to default?"
      description="Your personal layout will return to the standard cards and sizes. Your tasks, scouting reports and other boards stay as they are.">
      {error ? <p role="alert">{error}</p> : null}
      <div className="appearance-actions"><Button disabled={busy} onClick={() => setOpen(false)}>Cancel</Button>
        <Button variant="primary" disabled={busy} onClick={() => void reset()}>{busy ? "Resetting…" : "Reset Home"}</Button></div>
    </Modal>
  </section>;
}
