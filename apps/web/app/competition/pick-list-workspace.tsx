"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { Button, Modal } from "../../components/ui";
import { HubPanelSkeleton } from "../../components/product-hub";
import { useFollowUrl } from "../../lib/nav/use-follow-url";
import { URL_CHANGE_EVENT } from "../../lib/nav/url-change";

const Ranking = dynamic(() => import("../strategy/pick-list-workbench").then(module => module.PickListWorkbench), { ssr: false, loading: HubPanelSkeleton });
const Discussion = dynamic(() => import("../picklist-collab/picklist-collab-client"), { ssr: false, loading: HubPanelSkeleton });

/** One saved list, with ranking and team discussion in the same workspace. */
export function PickListWorkspace({ orgId, discussionDefault = false }: { orgId: string; discussionDefault?: boolean }) {
  const [discussion, setDiscussion] = useState(discussionDefault);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirmSwitch, setConfirmSwitch] = useState(false);
  useEffect(() => {
    if (discussionDefault) {
      const url = new URL(window.location.href);
      url.searchParams.set("tab", "picks");
      url.searchParams.set("view", "discussion");
      window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
      window.dispatchEvent(new Event(URL_CHANGE_EVENT));
    }
    setDiscussion(discussionDefault || new URLSearchParams(window.location.search).get("view") === "discussion");
  }, [discussionDefault]);
  useFollowUrl(() => setDiscussion(new URLSearchParams(window.location.search).get("view") === "discussion"));

  const switchView = () => {
    const next = !discussion;
    const url = new URL(window.location.href);
    url.searchParams.set("tab", "picks");
    if (next) url.searchParams.set("view", "discussion");
    else url.searchParams.delete("view");
    window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
    setDiscussion(next);
    setDirty(false);
    setConfirmSwitch(false);
    window.dispatchEvent(new Event(URL_CHANGE_EVENT));
  };

  return (
    <section className="pick-list-workspace" aria-label="Pick list workspace" data-testid="pick-list-workspace">
      <div className="pick-list-view-action">
        <Button variant="secondary" type="button" disabled={busy} title={busy ? "Wait for the current request to finish." : undefined} onClick={() => dirty ? setConfirmSwitch(true) : switchView()}>
          {discussion ? "Rank teams" : "Team discussion"}
        </Button>
      </div>
      {discussion ? <Discussion embedded onBusyChange={setBusy} onDirtyChange={setDirty} /> : <Ranking orgId={orgId} embedded onDirtyChange={setDirty} onBusyChange={setBusy} />}
      <Modal open={confirmSwitch} onClose={() => setConfirmSwitch(false)} title="Keep your unsaved changes?">
        <p>Save your changes before switching views, or discard the work you haven’t saved.</p>
        <div className="app-actions"><Button type="button" variant="primary" onClick={() => setConfirmSwitch(false)}>Keep editing</Button><Button type="button" variant="secondary" onClick={switchView}>Discard and switch</Button></div>
      </Modal>
    </section>
  );
}
