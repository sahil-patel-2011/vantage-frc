"use client";

import { useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { Button, Modal } from "../../components/ui";
import { HubPanelSkeleton } from "../../components/product-hub";
import { useFollowUrl } from "../../lib/nav/use-follow-url";
import { URL_CHANGE_EVENT } from "../../lib/nav/url-change";

const Ranking = dynamic(() => import("../strategy/pick-list-workbench").then(module => module.PickListWorkbench), { ssr: false, loading: HubPanelSkeleton });
const Discussion = dynamic(() => import("../picklist-collab/picklist-collab-client"), { ssr: false, loading: HubPanelSkeleton });

/** One saved list, with ranking and team discussion in the same workspace. */
export function PickListWorkspace({ orgId, discussionDefault = false }: { orgId: string; discussionDefault?: boolean }) {
  return <TeamPickListWorkspace key={orgId} orgId={orgId} discussionDefault={discussionDefault} />;
}

function TeamPickListWorkspace({ orgId, discussionDefault }: { orgId: string; discussionDefault: boolean }) {
  const [discussion, setDiscussion] = useState(discussionDefault);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [pendingView, setPendingView] = useState<boolean | null>(null);
  const initialDiscussionDefault = useRef(discussionDefault);
  useEffect(() => {
    if (initialDiscussionDefault.current) {
      const url = new URL(window.location.href);
      url.searchParams.set("tab", "picks");
      url.searchParams.set("view", "discussion");
      window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
      window.dispatchEvent(new Event(URL_CHANGE_EVENT));
    }
    setDiscussion(initialDiscussionDefault.current || new URLSearchParams(window.location.search).get("view") === "discussion");
  }, []);
  useFollowUrl(() => {
    const next = new URLSearchParams(window.location.search).get("view") === "discussion";
    if (next === discussion) return;
    if (dirty || busy) {
      const url = new URL(window.location.href);
      if (discussion) url.searchParams.set("view", "discussion"); else url.searchParams.delete("view");
      window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
      if (!busy) setPendingView(next);
      return;
    }
    setDiscussion(next);
  });

  const switchView = (next: boolean) => {
    if (busy) return;
    const url = new URL(window.location.href);
    url.searchParams.set("tab", "picks");
    if (next) url.searchParams.set("view", "discussion");
    else url.searchParams.delete("view");
    window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
    setDiscussion(next);
    setDirty(false);
    setPendingView(null);
    window.dispatchEvent(new Event(URL_CHANGE_EVENT));
  };

  return (
    <section className="pick-list-workspace" aria-label="Pick list workspace" data-testid="pick-list-workspace">
      <div className="pick-list-view-action">
        <Button variant="secondary" type="button" disabled={busy} onClick={() => dirty ? setPendingView(!discussion) : switchView(!discussion)}>
          {discussion ? "Rank teams" : "Team discussion"}
        </Button>
      </div>
      {discussion ? <Discussion key={orgId} orgId={orgId} embedded onBusyChange={setBusy} onDirtyChange={setDirty} /> : <Ranking key={orgId} orgId={orgId} embedded onDirtyChange={setDirty} onBusyChange={setBusy} />}
      <Modal open={pendingView !== null} onClose={() => setPendingView(null)} title="Keep your unsaved changes?">
        <p>Save your ranking or discussion inputs before switching views, or discard the changes you haven’t saved.</p>
        <div className="app-actions"><Button type="button" variant="primary" onClick={() => setPendingView(null)}>Keep editing</Button><Button type="button" variant="secondary" disabled={busy} onClick={() => { if (pendingView !== null) switchView(pendingView); }}>Discard and switch</Button></div>
      </Modal>
    </section>
  );
}
