"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { composeGrantAnswer, composeSponsorEmail, emailKindLabel, grantFocusLabel } from "../../lib/writer";
import { DRAFT_STATUSES, WRITER_TONES, type WriterView } from "../../lib/writer/compute-writer";
import type {
  DraftKind,
  DraftStatus,
  EmailKind,
  GrantFocus,
  WriterDraft,
  WriterProfile,
  WriterTone,
} from "../../lib/writer/types";

type LiveView = Extract<WriterView, { status: "live" }>;
type Mutate = (payload: Record<string, unknown>) => void;

const EMAIL_KINDS: EmailKind[] = ["cold_intro", "sponsorship_ask", "renewal", "thank_you", "grant_followup"];
const GRANT_FOCI: GrantFocus[] = ["general", "impact", "technical", "sustainability", "inclusion"];

function kindLabel(kind: DraftKind): string {
  return kind === "grant" ? "Grant answer" : emailKindLabel(kind);
}

export default function WriterClient() {
  const [view, setView] = useState<WriterView | null>(null);
  const [error, setError] = useState("");
  const [fetchFailed, setFetchFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [season, setSeason] = useState<number | null>(null);

  const orgId = view && "orgId" in view ? view.orgId : null;

  const load = useCallback((seasonOverride?: number) => {
    setFetchFailed(false);
    setError("");
    const params = new URLSearchParams(window.location.search);
    const urlOrg = params.get("orgId");
    const seasonQuery = seasonOverride ?? (params.get("season") ? Number(params.get("season")) : null);
    const query = new URLSearchParams();
    if (urlOrg) query.set("orgId", urlOrg);
    if (seasonQuery) query.set("season", String(seasonQuery));
    void fetch(`/api/writer${query.toString() ? `?${query.toString()}` : ""}`)
      .then(async (response) => {
        const data = (await response.json()) as WriterView | { error?: string };
        if (!response.ok || !("status" in data)) {
          setFetchFailed(true);
          return;
        }
        setView(data);
        setSeason(data.seasonYear);
      })
      .catch(() => setFetchFailed(true));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const mutate = useCallback<Mutate>(
    (payload) => {
      if (!orgId || busy) return;
      setBusy(true);
      setError("");
      void fetch("/api/writer", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ orgId, seasonYear: season ?? undefined, ...payload }),
      })
        .then(async (response) => {
          const data = (await response.json()) as WriterView | { error?: string };
          if (!response.ok || !("status" in data)) {
            setError("error" in data && data.error ? data.error : "Something went wrong.");
            return;
          }
          setView(data);
          setSeason(data.seasonYear);
        })
        .catch(() => setError("Network error — please try again."))
        .finally(() => setBusy(false));
    },
    [orgId, season, busy],
  );

  return (
    <main className="module-page">
      <header className="app-page-header">
        <div>
          <span className="breadcrumbs">Team / Writing Assistant</span>
          <h1>Grant &amp; Sponsorship Writer</h1>
          <p>
            Draft grant answers and sponsor pitches from this team&apos;s profile and business data only — template or
            metered FRC Assistant. Review and edit before sending; nothing is invented across orgs.
          </p>
        </div>
        {view?.status === "live" && view.seasons.length > 0 ? (
          <label className="app-muted" style={{ display: "flex", gap: 6, alignItems: "center" }}>
            Season
            <select
              value={season ?? view.seasonYear}
              onChange={(event) => {
                const next = Number(event.target.value);
                setSeason(next);
                load(next);
              }}
            >
              {view.seasons.map((year) => (
                <option key={year} value={year}>
                  {year}
                </option>
              ))}
            </select>
          </label>
        ) : null}
      </header>

      {error ? (
        <p className="telemetry-status" role="alert">
          {error}
        </p>
      ) : null}

      {fetchFailed ? (
        <section className="app-card soft-panel">
          <h2>Could not load the writing assistant</h2>
          <p className="app-muted">A network or server issue prevented loading. Try again.</p>
          <button type="button" className="app-button secondary" onClick={() => load()}>
            Retry
          </button>
        </section>
      ) : view == null ? (
        <section className="app-card soft-panel">
          <h2>Loading…</h2>
          <p className="app-muted">Checking your workspace.</p>
        </section>
      ) : view.status === "setup_required" ? (
        <section className="app-card soft-panel">
          <span className="app-badge setup">Setup required</span>
          <h2>{view.message}</h2>
          <ol className="strategy-setup-steps">
            {view.steps.map((step) => (
              <li key={step.id}>
                <div>
                  <strong>{step.label}</strong>
                  <span>{step.detail}</span>
                </div>
                <a href={step.href}>Open</a>
              </li>
            ))}
          </ol>
        </section>
      ) : (
        <WriterWorkspace view={view} busy={busy} mutate={mutate} setView={setView} setError={setError} setBusy={setBusy} />
      )}
    </main>
  );
}

function WriterWorkspace({
  view,
  busy,
  mutate,
  setView,
  setError,
  setBusy,
}: {
  view: LiveView;
  busy: boolean;
  mutate: Mutate;
  setView: (view: WriterView) => void;
  setError: (message: string) => void;
  setBusy: (busy: boolean) => void;
}) {
  const [profile, setProfile] = useState(() => toForm(view.profile));
  useEffect(() => {
    setProfile(toForm(view.profile));
  }, [view.computedAt]);

  const liveProfile: WriterProfile = useMemo(
    () => ({
      teamName: profile.teamName || "Our team",
      teamNumber: profile.teamNumber ? Number(profile.teamNumber) : null,
      region: profile.region || null,
      mission: profile.mission || null,
      achievements: profile.achievements.split(/\r?\n/).map((s) => s.trim()).filter(Boolean),
      fundingNeed: profile.fundingNeed || null,
      fundingAskUsd: profile.fundingAskUsd ? Number(profile.fundingAskUsd) : null,
      tone: profile.tone,
    }),
    [profile],
  );

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <ProfilePanel profile={profile} setProfile={setProfile} busy={busy} mutate={mutate} />
      <Composer
        liveProfile={liveProfile}
        profileForm={profile}
        orgId={view.orgId}
        seasonYear={view.seasonYear}
        busy={busy}
        mutate={mutate}
        setView={setView}
        setError={setError}
        setBusy={setBusy}
      />
      <DraftLibrary view={view} busy={busy} mutate={mutate} />
    </div>
  );
}

type ProfileForm = {
  teamName: string;
  teamNumber: string;
  region: string;
  mission: string;
  achievements: string;
  fundingNeed: string;
  fundingAskUsd: string;
  tone: WriterTone;
};

function toForm(profile: WriterProfile): ProfileForm {
  return {
    teamName: profile.teamName ?? "",
    teamNumber: profile.teamNumber ? String(profile.teamNumber) : "",
    region: profile.region ?? "",
    mission: profile.mission ?? "",
    achievements: profile.achievements.join("\n"),
    fundingNeed: profile.fundingNeed ?? "",
    fundingAskUsd: profile.fundingAskUsd ? String(profile.fundingAskUsd) : "",
    tone: profile.tone,
  };
}

function ProfilePanel({
  profile,
  setProfile,
  busy,
  mutate,
}: {
  profile: ProfileForm;
  setProfile: (updater: (prev: ProfileForm) => ProfileForm) => void;
  busy: boolean;
  mutate: Mutate;
}) {
  const set = (key: keyof ProfileForm) => (event: { target: { value: string } }) =>
    setProfile((prev) => ({ ...prev, [key]: event.target.value }));

  return (
    <section className="app-card soft-panel" style={{ display: "grid", gap: 10 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
        <h2 style={{ margin: 0 }}>Team profile</h2>
        <small className="app-muted">Used to tailor every draft — edits apply to the preview live.</small>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10 }}>
        <label style={{ display: "grid", gap: 4 }}>
          <span className="app-muted">Team name</span>
          <input value={profile.teamName} onChange={set("teamName")} />
        </label>
        <label style={{ display: "grid", gap: 4 }}>
          <span className="app-muted">Team number</span>
          <input type="number" min={1} value={profile.teamNumber} onChange={set("teamNumber")} />
        </label>
        <label style={{ display: "grid", gap: 4 }}>
          <span className="app-muted">Region</span>
          <input value={profile.region} onChange={set("region")} placeholder="Portland, OR" />
        </label>
        <label style={{ display: "grid", gap: 4 }}>
          <span className="app-muted">Default ask ($)</span>
          <input type="number" min={0} value={profile.fundingAskUsd} onChange={set("fundingAskUsd")} />
        </label>
        <label style={{ display: "grid", gap: 4 }}>
          <span className="app-muted">Tone</span>
          <select value={profile.tone} onChange={(e) => setProfile((prev) => ({ ...prev, tone: e.target.value as WriterTone }))}>
            {WRITER_TONES.map((tone) => (
              <option key={tone} value={tone}>
                {tone[0]?.toUpperCase() + tone.slice(1)}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label style={{ display: "grid", gap: 4 }}>
        <span className="app-muted">Mission (1–2 sentences)</span>
        <textarea value={profile.mission} onChange={set("mission")} rows={2} />
      </label>
      <label style={{ display: "grid", gap: 4 }}>
        <span className="app-muted">Key achievements (one per line)</span>
        <textarea value={profile.achievements} onChange={set("achievements")} rows={3} placeholder={"won our regional\nlogged 400 outreach hours\ngrew to 40 students"} />
      </label>
      <label style={{ display: "grid", gap: 4 }}>
        <span className="app-muted">What funding pays for</span>
        <input value={profile.fundingNeed} onChange={set("fundingNeed")} placeholder="registration, materials, and travel" />
      </label>
      <div>
        <button
          type="button"
          className="app-button secondary"
          disabled={busy}
          onClick={() =>
            mutate({
              action: "set-profile",
              teamName: profile.teamName || undefined,
              teamNumber: profile.teamNumber || undefined,
              region: profile.region || undefined,
              mission: profile.mission || undefined,
              achievements: profile.achievements || undefined,
              fundingNeed: profile.fundingNeed || undefined,
              fundingAskUsd: profile.fundingAskUsd || undefined,
              tone: profile.tone,
            })
          }
        >
          Save profile
        </button>
      </div>
    </section>
  );
}

type PitchResponse = WriterView & {
  pitch?: {
    subject: string | null;
    body: string;
    source: string;
    kind: DraftKind;
    runId: string;
    provider: string;
    model: string;
  };
};

function Composer({
  liveProfile,
  profileForm,
  orgId,
  seasonYear,
  busy,
  mutate,
  setView,
  setError,
  setBusy,
}: {
  liveProfile: WriterProfile;
  profileForm: ProfileForm;
  orgId: string;
  seasonYear: number;
  busy: boolean;
  mutate: Mutate;
  setView: (view: WriterView) => void;
  setError: (message: string) => void;
  setBusy: (busy: boolean) => void;
}) {
  const [kind, setKind] = useState<DraftKind>("sponsorship_ask");
  const [sponsorName, setSponsorName] = useState("");
  const [contactName, setContactName] = useState("");
  const [tier, setTier] = useState("");
  const [askAmount, setAskAmount] = useState("");
  const [priorAmount, setPriorAmount] = useState("");
  const [senderName, setSenderName] = useState("");
  const [senderRole, setSenderRole] = useState("");
  const [prompt, setPrompt] = useState("");
  const [charLimit, setCharLimit] = useState("");
  const [focus, setFocus] = useState<GrantFocus>("general");

  const [subject, setSubject] = useState("");
  const [draftBody, setDraftBody] = useState("");
  const [draftSource, setDraftSource] = useState<"template" | "ai" | null>(null);
  const [aiMeta, setAiMeta] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const isGrant = kind === "grant";

  const generate = () => {
    if (isGrant) {
      const text = composeGrantAnswer(liveProfile, {
        prompt,
        charLimit: charLimit ? Number(charLimit) : null,
        focus,
      });
      setSubject("");
      setDraftBody(text);
    } else {
      const email = composeSponsorEmail(kind as EmailKind, liveProfile, {
        sponsorName: sponsorName || "your organization",
        contactName: contactName || null,
        tier: tier || null,
        askAmountUsd: askAmount ? Number(askAmount) : null,
        priorAmountUsd: priorAmount ? Number(priorAmount) : null,
        senderName: senderName || null,
        senderRole: senderRole || null,
      });
      setSubject(email.subject);
      setDraftBody(email.body);
    }
    setDraftSource("template");
    setAiMeta(null);
    setCopied(false);
  };

  const generateWithAssistant = () => {
    if (busy) return;
    setBusy(true);
    setError("");
    void fetch("/api/writer", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        action: "ai-draft",
        orgId,
        seasonYear,
        kind,
        sponsorName: sponsorName || undefined,
        contactName: contactName || undefined,
        tier: tier || undefined,
        askAmountUsd: askAmount || undefined,
        priorAmountUsd: priorAmount || undefined,
        senderName: senderName || undefined,
        senderRole: senderRole || undefined,
        prompt: prompt || undefined,
        charLimit: charLimit || undefined,
        focus,
        teamName: profileForm.teamName || undefined,
        teamNumber: profileForm.teamNumber || undefined,
        region: profileForm.region || undefined,
        mission: profileForm.mission || undefined,
        achievements: profileForm.achievements || undefined,
        fundingNeed: profileForm.fundingNeed || undefined,
        fundingAskUsd: profileForm.fundingAskUsd || undefined,
        tone: profileForm.tone,
        save: true,
      }),
    })
      .then(async (response) => {
        const data = (await response.json()) as PitchResponse | { error?: string };
        if (!response.ok || !("status" in data)) {
          setError("error" in data && data.error ? data.error : "FRC Assistant draft failed.");
          return;
        }
        setView(data);
        if (data.pitch) {
          setSubject(data.pitch.subject ?? "");
          setDraftBody(data.pitch.body);
          setDraftSource(data.pitch.source === "ai" ? "ai" : "template");
          setAiMeta(
            data.pitch.source === "ai"
              ? `Metered FRC Assistant · ${data.pitch.provider}/${data.pitch.model}`
              : `Org-scoped template + business facts · usage logged (${data.pitch.provider})`,
          );
        }
        setCopied(false);
      })
      .catch(() => setError("Network error — please try again."))
      .finally(() => setBusy(false));
  };

  const copy = () => {
    const text = subject ? `Subject: ${subject}\n\n${draftBody}` : draftBody;
    void navigator.clipboard?.writeText(text).then(
      () => {
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1500);
      },
      () => undefined,
    );
  };

  const targetName = isGrant ? (prompt.slice(0, 60) || "Grant answer") : sponsorName || null;

  return (
    <section className="app-card soft-panel" style={{ display: "grid", gap: 12 }}>
      <h2 style={{ margin: 0 }}>Compose a draft</h2>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {(["grant", ...EMAIL_KINDS] as DraftKind[]).map((k) => (
          <button
            key={k}
            type="button"
            className={`app-badge ${kind === k ? "good" : "demo"}`}
            style={{ cursor: "pointer", border: "none" }}
            onClick={() => setKind(k)}
          >
            {kindLabel(k)}
          </button>
        ))}
      </div>

      {isGrant ? (
        <div style={{ display: "grid", gap: 10 }}>
          <label style={{ display: "grid", gap: 4 }}>
            <span className="app-muted">Grant question / prompt</span>
            <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} rows={2} placeholder="How will these funds impact your students?" />
          </label>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <label style={{ display: "grid", gap: 4 }}>
              <span className="app-muted">Focus</span>
              <select value={focus} onChange={(e) => setFocus(e.target.value as GrantFocus)}>
                {GRANT_FOCI.map((f) => (
                  <option key={f} value={f}>
                    {grantFocusLabel(f)}
                  </option>
                ))}
              </select>
            </label>
            <label style={{ display: "grid", gap: 4, width: 140 }}>
              <span className="app-muted">Char limit (optional)</span>
              <input type="number" min={0} value={charLimit} onChange={(e) => setCharLimit(e.target.value)} />
            </label>
          </div>
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10 }}>
          <label style={{ display: "grid", gap: 4 }}>
            <span className="app-muted">Sponsor / org name</span>
            <input value={sponsorName} onChange={(e) => setSponsorName(e.target.value)} />
          </label>
          <label style={{ display: "grid", gap: 4 }}>
            <span className="app-muted">Contact name</span>
            <input value={contactName} onChange={(e) => setContactName(e.target.value)} />
          </label>
          <label style={{ display: "grid", gap: 4 }}>
            <span className="app-muted">Tier (optional)</span>
            <input value={tier} onChange={(e) => setTier(e.target.value)} placeholder="Gold" />
          </label>
          <label style={{ display: "grid", gap: 4 }}>
            <span className="app-muted">Ask amount ($)</span>
            <input type="number" min={0} value={askAmount} onChange={(e) => setAskAmount(e.target.value)} />
          </label>
          <label style={{ display: "grid", gap: 4 }}>
            <span className="app-muted">Prior gift ($)</span>
            <input type="number" min={0} value={priorAmount} onChange={(e) => setPriorAmount(e.target.value)} />
          </label>
          <label style={{ display: "grid", gap: 4 }}>
            <span className="app-muted">Your name</span>
            <input value={senderName} onChange={(e) => setSenderName(e.target.value)} />
          </label>
          <label style={{ display: "grid", gap: 4 }}>
            <span className="app-muted">Your role</span>
            <input value={senderRole} onChange={(e) => setSenderRole(e.target.value)} placeholder="Team Captain" />
          </label>
        </div>
      )}

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <button type="button" className="app-button secondary" onClick={generate} disabled={busy}>
          Template draft
        </button>
        <button type="button" className="app-button" onClick={generateWithAssistant} disabled={busy}>
          {busy ? "Drafting…" : "Draft with FRC Assistant"}
        </button>
        <small className="app-muted">Uses this org&apos;s profile + business data only · metered usage ledger</small>
      </div>

      {draftBody ? (
        <div style={{ display: "grid", gap: 8, borderTop: "1px solid rgba(128,128,128,0.2)", paddingTop: 12 }}>
          {draftSource ? (
            <span className={`app-badge ${draftSource === "ai" ? "good" : "demo"}`}>
              {draftSource === "ai" ? "AI draft" : "Template draft"}
              {aiMeta ? ` · ${aiMeta}` : ""}
            </span>
          ) : null}
          {!isGrant ? (
            <label style={{ display: "grid", gap: 4 }}>
              <span className="app-muted">Subject</span>
              <input value={subject} onChange={(e) => setSubject(e.target.value)} />
            </label>
          ) : null}
          <label style={{ display: "grid", gap: 4 }}>
            <span className="app-muted">Draft (edit before sending)</span>
            <textarea value={draftBody} onChange={(e) => setDraftBody(e.target.value)} rows={12} style={{ fontFamily: "inherit", lineHeight: 1.5 }} />
          </label>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button type="button" className="app-button secondary" onClick={copy}>
              {copied ? "Copied!" : "Copy"}
            </button>
            <button
              type="button"
              className="app-button"
              disabled={busy || !draftBody.trim()}
              onClick={() =>
                mutate({
                  action: "save-draft",
                  kind,
                  title: `${kindLabel(kind)}${targetName && !isGrant ? ` — ${targetName}` : ""}`,
                  targetName: targetName || undefined,
                  subject: subject || undefined,
                  body: draftBody,
                  source: draftSource ?? "template",
                })
              }
            >
              Save draft
            </button>
            <small className="app-muted" style={{ alignSelf: "center" }}>
              Org-scoped only — review before sending.
            </small>
          </div>
        </div>
      ) : null}
    </section>
  );
}

function DraftLibrary({ view, busy, mutate }: { view: LiveView; busy: boolean; mutate: Mutate }) {
  if (view.drafts.length === 0) {
    return (
      <section className="app-card soft-panel">
        <span className="app-badge setup">No saved drafts</span>
        <h2>Your draft library</h2>
        <p className="app-muted">Generate a grant answer or sponsor email above and save it here to reuse and refine.</p>
      </section>
    );
  }
  return (
    <section style={{ display: "grid", gap: 12 }}>
      <h2 style={{ margin: 0 }}>Saved drafts ({view.drafts.length})</h2>
      {view.drafts.map((draft) => (
        <DraftCard key={draft.id} draft={draft} busy={busy} mutate={mutate} />
      ))}
    </section>
  );
}

function DraftCard({ draft, busy, mutate }: { draft: WriterDraft; busy: boolean; mutate: Mutate }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const copy = () => {
    const text = draft.subject ? `Subject: ${draft.subject}\n\n${draft.body}` : draft.body;
    void navigator.clipboard?.writeText(text).then(
      () => {
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1500);
      },
      () => undefined,
    );
  };
  return (
    <article className="app-card soft-panel">
      <header style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-start" }}>
        <div>
          <span className="app-badge demo">{kindLabel(draft.kind)}</span>{" "}
          {draft.source === "ai" ? <span className="app-badge good">AI</span> : null}{" "}
          <small className="app-muted">{new Date(draft.createdAt).toLocaleDateString()}</small>
          <h3 style={{ margin: "4px 0 0", fontSize: "1.05rem" }}>{draft.title}</h3>
          {draft.subject ? <small className="app-muted">Subject: {draft.subject}</small> : null}
        </div>
        <select
          value={draft.status}
          disabled={busy}
          aria-label="Draft status"
          onChange={(event) => mutate({ action: "update-draft", draftId: draft.id, status: event.target.value })}
        >
          {DRAFT_STATUSES.map((status: DraftStatus) => (
            <option key={status} value={status}>
              {status[0]?.toUpperCase() + status.slice(1)}
            </option>
          ))}
        </select>
      </header>
      {open ? (
        <pre style={{ whiteSpace: "pre-wrap", fontFamily: "inherit", margin: "10px 0 0", lineHeight: 1.5 }}>{draft.body}</pre>
      ) : null}
      <footer style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 10, flexWrap: "wrap" }}>
        <button type="button" className="text-button" onClick={() => setOpen((v) => !v)}>
          {open ? "Hide" : "View"}
        </button>
        <button type="button" className="text-button" onClick={copy}>
          {copied ? "Copied!" : "Copy"}
        </button>
        <button
          type="button"
          className="text-button"
          disabled={busy}
          onClick={() => {
            if (window.confirm(`Delete "${draft.title}"?`)) mutate({ action: "delete-draft", draftId: draft.id });
          }}
          style={{ marginLeft: "auto" }}
        >
          Delete
        </button>
      </footer>
    </article>
  );
}
