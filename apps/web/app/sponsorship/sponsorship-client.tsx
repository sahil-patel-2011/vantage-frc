"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { EmptyState, PageHeader, Panel, Button } from "../../components/ui";
import { classifyLoadFailure, loadFailureCopy } from "../../lib/ui/load-failure";
import {
  buildOnePagerLines,
  defaultTitle,
  evaluateCompleteness,
  moneyLabel,
  STATUS_LABEL,
  type SponsorshipOnePager,
  type SponsorshipView,
} from "../../lib/sponsorship-value-prop";

type DraftFields = {
  title: string;
  whoWeAre: string;
  whatWeDo: string;
  askCashUsd: string;
  askParts: string;
  askMentorship: string;
  sponsorGets: string;
  inviteEnabled: boolean;
  inviteDetails: string;
};

function emptyDraft(title: string, seedWho: string | null, seedNeed: string | null): DraftFields {
  return {
    title,
    whoWeAre: seedWho ?? "",
    whatWeDo: seedNeed ?? "",
    askCashUsd: "",
    askParts: "",
    askMentorship: "",
    sponsorGets: "",
    inviteEnabled: false,
    inviteDetails: "",
  };
}

function fromPage(page: SponsorshipOnePager): DraftFields {
  return {
    title: page.title,
    whoWeAre: page.whoWeAre,
    whatWeDo: page.whatWeDo,
    askCashUsd: page.askCashUsd != null ? String(page.askCashUsd) : "",
    askParts: page.askParts,
    askMentorship: page.askMentorship,
    sponsorGets: page.sponsorGets,
    inviteEnabled: page.inviteEnabled,
    inviteDetails: page.inviteDetails,
  };
}

function draftAsPage(draft: DraftFields, base: SponsorshipOnePager | null, seasonYear: number): SponsorshipOnePager {
  const ask = draft.askCashUsd.trim() === "" ? null : Number(draft.askCashUsd);
  return {
    id: base?.id ?? "preview",
    title: draft.title || "Sponsorship one-pager",
    seasonYear: base?.seasonYear ?? seasonYear,
    whoWeAre: draft.whoWeAre,
    whatWeDo: draft.whatWeDo,
    askCashUsd: ask != null && Number.isFinite(ask) ? ask : null,
    askParts: draft.askParts,
    askMentorship: draft.askMentorship,
    sponsorGets: draft.sponsorGets,
    inviteEnabled: draft.inviteEnabled,
    inviteDetails: draft.inviteDetails,
    status: base?.status ?? "draft",
    createdByName: base?.createdByName ?? null,
    createdAt: base?.createdAt ?? "",
    updatedAt: base?.updatedAt ?? "",
  };
}

async function downloadBlob(response: Response, fallbackName: string) {
  const blob = await response.blob();
  const header = response.headers.get("content-disposition") ?? "";
  const match = /filename="([^"]+)"/i.exec(header);
  const name = match?.[1] ?? fallbackName;
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  URL.revokeObjectURL(url);
}

export default function SponsorshipClient({ embedded = false }: { embedded?: boolean } = {}) {
  const [view, setView] = useState<SponsorshipView | null>(null);
  const [error, setError] = useState("");
  // Kept so an expired session offers sign-in instead of a dead end.
  const [errorStatus, setErrorStatus] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [season, setSeason] = useState<number | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<DraftFields | null>(null);
  const [message, setMessage] = useState("");

  const load = useCallback((seasonOverride?: number, preferId?: string | null) => {
    setError("");
    setErrorStatus(null);
    const params = new URLSearchParams(window.location.search);
    const urlOrg = params.get("orgId");
    const seasonQuery = seasonOverride ?? (params.get("season") ? Number(params.get("season")) : null);
    const query = new URLSearchParams();
    if (urlOrg) query.set("orgId", urlOrg);
    if (seasonQuery) query.set("season", String(seasonQuery));
    void fetch(`/api/sponsorship${query.toString() ? `?${query.toString()}` : ""}`)
      .then(async (response) => {
        const data = (await response.json()) as SponsorshipView | { error?: string };
        if (!response.ok || !("status" in data)) {
          setError("error" in data && data.error ? data.error : "Could not load sponsorship one-pagers.");
          setErrorStatus(response.status);
          return;
        }
        setView(data);
        setSeason(data.seasonYear);
        if (data.status === "ready") {
          const preferred =
            (preferId && data.onePagers.find((page) => page.id === preferId)) || data.onePagers[0] || null;
          setSelectedId(preferred?.id ?? null);
          setDraft(
            preferred
              ? fromPage(preferred)
              : emptyDraft(
                  defaultTitle(data.context.teamNumber, data.seasonYear),
                  data.context.seedWhoWeAre,
                  data.context.seedFundingNeed,
                ),
          );
        }
      })
      .catch(() => setError("Network error — please try again."));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const selected = useMemo(() => {
    if (!view || view.status !== "ready" || !selectedId) return null;
    return view.onePagers.find((page) => page.id === selectedId) ?? null;
  }, [view, selectedId]);

  const previewPage = useMemo(() => {
    if (!view || view.status !== "ready" || !draft) return null;
    return draftAsPage(draft, selected, view.seasonYear);
  }, [view, draft, selected]);

  const completeness = useMemo(() => (previewPage ? evaluateCompleteness(previewPage) : null), [previewPage]);

  async function mutate(payload: Record<string, unknown>, okMessage?: string) {
    if (!view || view.status !== "ready" || !view.context.orgId || busy) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch("/api/sponsorship", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          orgId: view.context.orgId,
          seasonYear: season ?? view.seasonYear,
          ...payload,
        }),
      });
      if (payload.action === "pdf") {
        if (!response.ok) {
          const data = (await response.json()) as { error?: string };
          setError(data.error ?? "PDF export failed");
          return;
        }
        await downloadBlob(response, "vantage-sponsorship-one-pager.pdf");
        setMessage("PDF downloaded.");
        return;
      }
      const data = (await response.json()) as SponsorshipView | { error?: string };
      if (!response.ok || !("status" in data)) {
        setError("error" in data && data.error ? data.error : "Something went wrong.");
        return;
      }
      setView(data);
      setSeason(data.seasonYear);
      if (data.status === "ready") {
        const prefer =
          payload.action === "create"
            ? (data.onePagers[0]?.id ?? null)
            : typeof payload.id === "string"
              ? payload.id
              : selectedId;
        const next = (prefer && data.onePagers.find((page) => page.id === prefer)) || data.onePagers[0] || null;
        setSelectedId(next?.id ?? null);
        if (next) setDraft(fromPage(next));
        else if (payload.action === "delete") {
          setDraft(
            emptyDraft(
              defaultTitle(data.context.teamNumber, data.seasonYear),
              data.context.seedWhoWeAre,
              data.context.seedFundingNeed,
            ),
          );
        }
      }
      if (okMessage) setMessage(okMessage);
    } catch {
      setError("Network error — please try again.");
    } finally {
      setBusy(false);
    }
  }

  function selectPage(page: SponsorshipOnePager) {
    setSelectedId(page.id);
    setDraft(fromPage(page));
    setMessage("");
  }

  async function copyText() {
    if (!view || view.status !== "ready" || !previewPage) return;
    const lines = buildOnePagerLines(previewPage, {
      orgName: view.context.orgName,
      teamNumber: view.context.teamNumber,
    });
    try {
      await navigator.clipboard.writeText(lines.join("\n"));
      setMessage("Copied one-pager text.");
    } catch {
      setError("Clipboard unavailable — try PDF export instead.");
    }
  }

  if (!view) {
    const copy = error
      ? loadFailureCopy(
          classifyLoadFailure({
            status: errorStatus,
            message: error,
            online: typeof navigator === "undefined" ? true : navigator.onLine,
          }),
          {
            nextPath:
              typeof window === "undefined"
                ? null
                : `${window.location.pathname}${window.location.search}`,
            message: error,
          },
        )
      : null;
    return (
      <main className={`module-page svp-page${embedded ? " is-embedded" : ""}`}>
        {!embedded ? (
          <PageHeader
            navPath="/sponsorship"
            title="Sponsorship one-pagers"
            description={copy ? copy.title : "Loading…"}
          />
        ) : null}
        {copy ? (
          <>
            <p className="telemetry-status" role="alert">
              <strong>{copy.title}</strong> — {copy.description}
            </p>
            {copy.primary ? (
              <Button as="a" variant="primary" href={copy.primary.href}>
                {copy.primary.label}
              </Button>
            ) : null}
          </>
        ) : null}
      </main>
    );
  }

  if (view.status === "setup_required") {
    return (
      <main className={`module-page svp-page${embedded ? " is-embedded" : ""}`}>
        {!embedded ? (
          <PageHeader
            navPath="/sponsorship"
            title="Sponsorship one-pagers"
            description="Compose org-isolated value props for cash, parts, and mentorship."
          />
        ) : null}
        <EmptyState title="Select a team" description={view.message}>
          <Button as="a" variant="primary" href="/workspace">
            Choose your team
          </Button>
        </EmptyState>
      </main>
    );
  }

  const { context, onePagers, seasons, seasonYear } = view;

  return (
    <main className={`module-page svp-page${embedded ? " is-embedded" : ""}`}>
      {!embedded ? (
      <PageHeader
        navPath="/sponsorship"
        title="Sponsorship one-pagers"
        description="Build a one-pager for THIS team only — who you are, what you do, what you ask, and what sponsors get. Export PDF when ready."
      >
        <div className="svp-toolbar">
          <label className="app-muted" style={{ display: "flex", gap: 6, alignItems: "center" }}>
            Season
            <select
              value={season ?? seasonYear}
              onChange={(event) => {
                const next = Number(event.target.value);
                setSeason(next);
                setSelectedId(null);
                setDraft(null);
                load(next);
              }}
            >
              {(seasons.length ? seasons : [seasonYear]).map((year) => (
                <option key={year} value={year}>
                  {year}
                </option>
              ))}
            </select>
          </label>
          {context.orgId ? (
            <>
              <Button as="a" variant="secondary"
                href={`/business?orgId=${encodeURIComponent(context.orgId)}&tab=sponsors`}
              >
                Sponsor pipeline
              </Button>
              <Button as="a" variant="secondary" href={`/sponsor-suite?orgId=${encodeURIComponent(context.orgId)}`}>
                Sponsor Suite
              </Button>
              <Button as="a" variant="secondary" href={`/media-kit?orgId=${encodeURIComponent(context.orgId)}`}>
                Media kit
              </Button>
            </>
          ) : null}
          <Button variant="primary" type="button" disabled={busy} onClick={() => void mutate( { action: "create", title: defaultTitle(context.teamNumber, season ?? seasonYear), whoWeAre: context.seedWhoWeAre ?? "", whatWeDo: context.seedFundingNeed ?? "", }, "One-pager created.", ) }>
            New one-pager
          </Button>
        </div>
      </PageHeader>
      ) : (
        <div className="svp-toolbar svp-embed-toolbar">
          <label className="app-muted" style={{ display: "flex", gap: 6, alignItems: "center" }}>
            Season
            <select
              value={season ?? seasonYear}
              onChange={(event) => {
                const next = Number(event.target.value);
                setSeason(next);
                setSelectedId(null);
                setDraft(null);
                load(next);
              }}
            >
              {(seasons.length ? seasons : [seasonYear]).map((year) => (
                <option key={year} value={year}>
                  {year}
                </option>
              ))}
            </select>
          </label>
          <Button variant="primary" type="button" disabled={busy} onClick={() => void mutate( { action: "create", title: defaultTitle(context.teamNumber, season ?? seasonYear), whoWeAre: context.seedWhoWeAre ?? "", whatWeDo: context.seedFundingNeed ?? "", }, "One-pager created.", ) }>
            New one-pager
          </Button>
        </div>
      )}

      {error ? (
        <p className="telemetry-status" role="alert">
          {error}
        </p>
      ) : null}
      {message ? <p className="telemetry-status">{message}</p> : null}
      <p className="svp-note">
        Data stays inside {context.teamNumber != null ? `FRC ${context.teamNumber}` : (context.orgName ?? "this team")} —
        no cross-org stories or stats are pulled in.
      </p>

      <div className="svp-layout">
        <Panel as="aside">
          <span className="eyebrow">Library</span>
          <div className="svp-list">
            {onePagers.length === 0 ? (
              <p className="empty-hint">No one-pagers yet for {season ?? seasonYear}. Create one to start composing.</p>
            ) : (
              onePagers.map((page) => (
                <button
                  key={page.id}
                  type="button"
                  className={page.id === selectedId ? "svp-list-item active" : "svp-list-item"}
                  onClick={() => selectPage(page)}
                >
                  <strong>{page.title}</strong>
                  <span className={page.status === "ready" ? "svp-badge ready" : "svp-badge"}>
                    {STATUS_LABEL[page.status]}
                  </span>
                  <span>Updated {new Date(page.updatedAt).toLocaleDateString()}</span>
                </button>
              ))
            )}
          </div>
        </Panel>

        <section className="svp-composer">
          {!selected || !draft ? (
            <Panel>
              <EmptyState
                title={onePagers.length ? "Pick a one-pager" : "Create your first one-pager"}
                description="Compose who you are, what you do, what you ask, and what sponsors get — then export PDF. Only this team's story is used."
              >
                {!onePagers.length ? (
                  <Button variant="primary" type="button" disabled={busy} onClick={() => void mutate( { action: "create", title: defaultTitle(context.teamNumber, season ?? seasonYear), whoWeAre: context.seedWhoWeAre ?? "", whatWeDo: context.seedFundingNeed ?? "", }, "One-pager created.", ) }>
                    New one-pager
                  </Button>
                ) : null}
              </EmptyState>
            </Panel>
          ) : (
            <div className="svp-composer-grid">
              <Panel>
                <span className="eyebrow">Composer</span>
                <h2 style={{ margin: "4px 0 10px", fontSize: 18 }}>{draft.title || "Untitled"}</h2>
                <form
                  className="svp-form"
                  onSubmit={(event) => {
                    event.preventDefault();
                    if (!selected) return;
                    void mutate(
                      {
                        action: "update",
                        id: selected.id,
                        title: draft.title,
                        whoWeAre: draft.whoWeAre,
                        whatWeDo: draft.whatWeDo,
                        askCashUsd: draft.askCashUsd === "" ? null : Number(draft.askCashUsd),
                        askParts: draft.askParts,
                        askMentorship: draft.askMentorship,
                        sponsorGets: draft.sponsorGets,
                        inviteEnabled: draft.inviteEnabled,
                        inviteDetails: draft.inviteDetails,
                      },
                      "Saved.",
                    );
                  }}
                >
                  <label>
                    Title
                    <input
                      value={draft.title}
                      onChange={(event) => setDraft({ ...draft, title: event.target.value })}
                      maxLength={160}
                      required
                    />
                  </label>
                  <label>
                    Who we are
                    <textarea
                      value={draft.whoWeAre}
                      onChange={(event) => setDraft({ ...draft, whoWeAre: event.target.value })}
                      placeholder="THIS team's background only — school, years competing, student count, mission."
                      rows={4}
                    />
                  </label>
                  <label>
                    What we do
                    <textarea
                      value={draft.whatWeDo}
                      onChange={(event) => setDraft({ ...draft, whatWeDo: event.target.value })}
                      placeholder="Build season, outreach, mentoring, competition goals — real program work."
                      rows={4}
                    />
                  </label>
                  <div>
                    <span className="eyebrow">What we request</span>
                    <div className="svp-ask-grid" style={{ marginTop: 8 }}>
                      <label>
                        Cash ($)
                        <input
                          type="number"
                          min={0}
                          step="0.01"
                          value={draft.askCashUsd}
                          onChange={(event) => setDraft({ ...draft, askCashUsd: event.target.value })}
                          placeholder="2500"
                        />
                      </label>
                      <label>
                        Parts / materials
                        <input
                          value={draft.askParts}
                          onChange={(event) => setDraft({ ...draft, askParts: event.target.value })}
                          placeholder="Aluminum, fasteners, 3D filament…"
                        />
                      </label>
                    </div>
                    <label style={{ marginTop: 10 }}>
                      Mentorship
                      <input
                        value={draft.askMentorship}
                        onChange={(event) => setDraft({ ...draft, askMentorship: event.target.value })}
                        placeholder="Machining, software, business mentors…"
                      />
                    </label>
                  </div>
                  <label>
                    What the sponsor gets
                    <textarea
                      value={draft.sponsorGets}
                      onChange={(event) => setDraft({ ...draft, sponsorGets: event.target.value })}
                      placeholder="Logo placement, pit banner, social shout-outs, shop tours, impact report…"
                      rows={4}
                    />
                  </label>
                  <label className="svp-check">
                    <input
                      type="checkbox"
                      checked={draft.inviteEnabled}
                      onChange={(event) => setDraft({ ...draft, inviteEnabled: event.target.checked })}
                    />
                    Include “come see us” invite
                  </label>
                  {draft.inviteEnabled ? (
                    <label>
                      Invite details
                      <textarea
                        value={draft.inviteDetails}
                        onChange={(event) => setDraft({ ...draft, inviteDetails: event.target.value })}
                        placeholder="Shop open house, demo day, or competition visit — when & where."
                        rows={3}
                      />
                    </label>
                  ) : null}

                  {completeness ? (
                    <div className="svp-meter" aria-label="Completeness">
                      <i className={completeness.whoWeAre ? "ok" : undefined}>Who we are</i>
                      <i className={completeness.whatWeDo ? "ok" : undefined}>What we do</i>
                      <i className={completeness.hasAsk ? "ok" : undefined}>Ask</i>
                      <i className={completeness.sponsorGets ? "ok" : undefined}>Sponsor gets</i>
                      {draft.inviteEnabled ? (
                        <i className={completeness.inviteOk ? "ok" : undefined}>Invite</i>
                      ) : null}
                    </div>
                  ) : null}

                  <div className="svp-actions">
                    <Button variant="primary" type="submit" disabled={busy || !selected}>
                      Save
                    </Button>
                    <Button variant="secondary" type="button" disabled={busy || !selected || !completeness?.complete} onClick={() => selected && void mutate( { action: "update", id: selected.id, title: draft.title, whoWeAre: draft.whoWeAre, whatWeDo: draft.whatWeDo, askCashUsd: draft.askCashUsd === "" ? null : Number(draft.askCashUsd), askParts: draft.askParts, askMentorship: draft.askMentorship, sponsorGets: draft.sponsorGets, inviteEnabled: draft.inviteEnabled, inviteDetails: draft.inviteDetails, status: "ready", }, "Marked ready to share.", ) }>
                      Mark ready
                    </Button>
                    <Button variant="secondary" type="button" disabled={busy || !selected} onClick={() => selected && void mutate({ action: "pdf", id: selected.id })}>
                      Export PDF
                    </Button>
                    <Button variant="secondary" type="button" disabled={!previewPage} onClick={() => void copyText()}>
                      Copy text
                    </Button>
                    {selected ? (
                      <Button variant="secondary" type="button" disabled={busy} onClick={() => void mutate({ action: "delete", id: selected.id }, "Deleted.")}>
                        Delete
                      </Button>
                    ) : null}
                  </div>
                </form>
              </Panel>

              <article className="svp-preview" aria-label="One-pager preview">
                <header>
                  <strong>{previewPage?.title}</strong>
                  <span>
                    {context.teamNumber != null ? `FRC ${context.teamNumber}` : context.orgName} · Season{" "}
                    {previewPage?.seasonYear}
                    {previewPage?.status === "ready" ? " · Ready" : " · Draft"}
                  </span>
                </header>
                <section>
                  <h3>Who we are</h3>
                  <p>{previewPage?.whoWeAre.trim() || "Add your team background — this team only."}</p>
                </section>
                <section>
                  <h3>What we do</h3>
                  <p>{previewPage?.whatWeDo.trim() || "Describe your program and season work."}</p>
                </section>
                <section>
                  <h3>What we request</h3>
                  <ul>
                    {previewPage && moneyLabel(previewPage.askCashUsd) ? (
                      <li>Cash support: {moneyLabel(previewPage.askCashUsd)}</li>
                    ) : null}
                    {previewPage?.askParts.trim() ? <li>Parts / materials: {previewPage.askParts}</li> : null}
                    {previewPage?.askMentorship.trim() ? <li>Mentorship: {previewPage.askMentorship}</li> : null}
                    {!previewPage?.askCashUsd && !previewPage?.askParts.trim() && !previewPage?.askMentorship.trim() ? (
                      <li>Add a cash, parts, or mentorship ask.</li>
                    ) : null}
                  </ul>
                </section>
                <section>
                  <h3>What you get</h3>
                  <p>{previewPage?.sponsorGets.trim() || "List recognition and partnership benefits."}</p>
                </section>
                {previewPage?.inviteEnabled ? (
                  <section>
                    <h3>Come see us</h3>
                    <p>{previewPage.inviteDetails.trim() || "Add open-house or event invite details."}</p>
                  </section>
                ) : null}
              </article>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
