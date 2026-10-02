"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AiHubRelated } from "../../components/ai-hub-related";
import { OfflineBanner } from "../../components/offline-banner";
import { UsageCutoffBanner, resolveCutoffErrorCode } from "../../components/usage-cutoff-banner";
import { ModelProvenance, Button, EmptyState } from "../../components/ui";
import { fetchProductSession } from "../../lib/nav/product-session";
import { FEATURE_API_TIMEOUT_MS } from "../../lib/nav/resolve-org";
import { strategyCanSync } from "../../lib/strategy/strategy-related";
import { getFeatureSnapshot, putFeatureSnapshot } from "../../lib/offline/feature-cache";
import {
  composeGrantAnswer,
  composeSponsorEmail,
  emailKindLabel,
  grantFocusLabel,
  writerRelatedLinks,
  writerShellCopy,
  WRITER_RELATED_INCLUDE,
} from "../../lib/writer";
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
import { ConnectAiNotice } from "../../components/connect-ai-notice";
import { writerNextActions } from "../../lib/writer/writer-next-actions";

type LiveView = Extract<WriterView, { status: "live" }>;
type Mutate = (payload: Record<string, unknown>) => void;

const EMAIL_KINDS: EmailKind[] = ["cold_intro", "sponsorship_ask", "renewal", "thank_you", "grant_followup"];
const GRANT_FOCI: GrantFocus[] = ["general", "impact", "technical", "sustainability", "inclusion"];

function kindLabel(kind: DraftKind): string {
  return kind === "grant" ? "Grant answer" : emailKindLabel(kind);
}

function isWriterView(value: unknown): value is WriterView {
  if (!value || typeof value !== "object") return false;
  const status = (value as { status?: unknown }).status;
  return status === "setup_required" || status === "live";
}

function writerCacheOrg(data: WriterView, orgHint: string): string {
  if (typeof data.orgId === "string" && data.orgId.trim()) return data.orgId;
  return orgHint;
}

async function persistWriterSnapshot(orgHint: string, seasonHint: string, data: WriterView): Promise<void> {
  const cacheOrg = writerCacheOrg(data, orgHint);
  if (!cacheOrg) return;
  const seasonKey = String(data.seasonYear);
  try {
    await putFeatureSnapshot("writer", cacheOrg, data, seasonHint || seasonKey);
    if (!orgHint) await putFeatureSnapshot("writer", "_", data, seasonHint || seasonKey);
  } catch {
    // Live Writer already painted; IndexedDB is best-effort.
  }
}

function WriterNextActions({
  orgId,
  draftCount,
  hasMission,
  hasAchievements,
}: {
  orgId?: string | null;
  draftCount: number;
  hasMission: boolean;
  hasAchievements: boolean;
}) {
  const actions = writerNextActions({ orgId, draftCount, hasMission, hasAchievements });
  if (!actions.length) return null;
  return (
    <section className="writer-next-actions app-card soft-panel edc-next-actions" aria-label="Next actions">
      <header>
        <h2>Next actions</h2>
        <p>Each one opens the page where you finish the work.</p>
      </header>
      <ol>
        {actions.map((action) => (
          <li key={action.id} className={action.primary ? "primary" : undefined}>
            <a className="edc-next-action" href={action.href}>
              <strong>{action.label}</strong>
              <span>{action.detail}</span>
            </a>
          </li>
        ))}
      </ol>
    </section>
  );
}

function WriterCrossLinks({ orgId }: { orgId: string }) {
  const links = writerRelatedLinks(orgId, { include: WRITER_RELATED_INCLUDE });
  if (!links.length) return null;
  return (
    <nav className="writer-cross-links intel-actions" aria-label="Related writing tools">
      {links.map((link) => (
        <a key={link.id} href={link.href}>
          {link.label}
        </a>
      ))}
    </nav>
  );
}

export default function WriterClient({ orgId: orgIdProp }: { orgId?: string | null } = {}) {
  const [view, setView] = useState<WriterView | null>(null);
  const [error, setError] = useState("");
  const [fetchFailed, setFetchFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [season, setSeason] = useState<number | null>(null);
  const [cutoffCode, setCutoffCode] = useState<string | null>(null);
  const [fromCache, setFromCache] = useState(false);
  const [cachedAt, setCachedAt] = useState<string | null>(null);
  const [canManageProfile, setCanManageProfile] = useState(false);
  const viewRef = useRef<WriterView | null>(null);
  viewRef.current = view;

  const orgId = (view && "orgId" in view ? view.orgId : null) ?? orgIdProp ?? null;

  const load = useCallback(
    async (seasonOverride?: number) => {
      const params = new URLSearchParams(window.location.search);
      const orgHint = (params.get("orgId") ?? orgIdProp)?.trim() ?? "";
      const seasonQuery = seasonOverride ?? (params.get("season") ? Number(params.get("season")) : null);
      const seasonHint =
        seasonQuery && Number.isFinite(seasonQuery) ? String(seasonQuery) : String(new Date().getFullYear());
      let hadCache = Boolean(viewRef.current);
      try {
        const cached = await getFeatureSnapshot<WriterView>("writer", orgHint || "_", seasonHint);
        if (!viewRef.current && cached?.data && isWriterView(cached.data)) {
          setView(cached.data);
          setSeason(cached.data.seasonYear);
          setFromCache(true);
          setCachedAt(cached.cachedAt);
          hadCache = true;
        }
      } catch {
        // IndexedDB missing or blocked; live fetch still runs.
      }
      setFetchFailed(false);
      setError("");
      setCutoffCode(null);
      try {
        const query = new URLSearchParams();
        if (orgHint) query.set("orgId", orgHint);
        if (seasonQuery) query.set("season", String(seasonQuery));
        const response = await fetch(`/api/writer${query.toString() ? `?${query.toString()}` : ""}`, {
          cache: "no-store",
          signal: AbortSignal.timeout(FEATURE_API_TIMEOUT_MS),
        });
        const data: unknown = await response.json().catch(() => null);
        if (response.status === 401 || response.status === 403) {
          setView(null);
          setFromCache(false);
          setCachedAt(null);
          setFetchFailed(true);
          return;
        }
        if (!response.ok || !isWriterView(data)) {
          if (hadCache || viewRef.current) {
            setFromCache(true);
            setError("Could not refresh Writer. Showing the last copy on this device.");
            setFetchFailed(false);
            return;
          }
          setFetchFailed(true);
          return;
        }
        setView(data);
        setSeason(data.seasonYear);
        setFromCache(false);
        setCachedAt(null);
        await persistWriterSnapshot(orgHint, seasonHint, data);
      } catch {
        if (hadCache || viewRef.current) {
          setFromCache(true);
          setError("Could not refresh Writer. Showing the last copy on this device.");
          setFetchFailed(false);
          return;
        }
        setFetchFailed(true);
      }
    },
    [orgIdProp],
  );

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    let cancelled = false;
    void fetchProductSession(orgId).then((session) => {
      if (cancelled) return;
      const membership = session?.memberships?.find((entry) => entry.orgId === orgId);
      setCanManageProfile(strategyCanSync(membership?.role ?? session?.role));
    });
    return () => {
      cancelled = true;
    };
  }, [orgId]);

  const mutate = useCallback<Mutate>(
    (payload) => {
      if (!orgId || busy) return;
      if (payload.action === "set-profile" && !canManageProfile) return;
      setBusy(true);
      setError("");
      void fetch("/api/writer", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ orgId, seasonYear: season ?? undefined, ...payload }),
        signal: AbortSignal.timeout(FEATURE_API_TIMEOUT_MS),
      })
        .then(async (response) => {
          const data: unknown = await response.json().catch(() => null);
          if (!response.ok || !isWriterView(data)) {
            setError(
              data && typeof data === "object" && "error" in data && typeof data.error === "string"
                ? data.error
                : "Something went wrong.",
            );
            return;
          }
          setView(data);
          setSeason(data.seasonYear);
          setFromCache(false);
          void persistWriterSnapshot(orgId, String(data.seasonYear), data);
        })
        .catch(() => setError("Network error — please try again."))
        .finally(() => setBusy(false));
    },
    [orgId, season, busy, canManageProfile],
  );

  const setupOrg =
    view?.status === "setup_required" ? view.orgId : orgId;
  const live = view?.status === "live" ? view : null;
  const loadingCopy = writerShellCopy("loading");
  const errorCopy = writerShellCopy("error");
  const setupCopy = writerShellCopy("setup");
  const setupPrimary = writerNextActions({ orgId: setupOrg, draftCount: 0 })[0] ?? null;

  return (
    <main className="module-page writer-page">
      <header className="app-page-header">
        <div>
          <span className="breadcrumbs">AI / Writing Assistant</span>
          <h1>Grant &amp; Sponsorship Writer</h1>
          <p>
            Write grant answers and sponsor emails using your team profile. Review and edit each draft before sending.
          </p>
        </div>
      </header>

      {orgId ? <AiHubRelated orgId={orgId} active="writer" /> : null}
      {/* No link rows up here: Chat and Budgets are the AI tabs just above, and Grants, Awards and
          Knowledge sit beside Saved drafts below (they were shown twice). */}

      {orgId && cutoffCode ? <UsageCutoffBanner orgId={orgId} errorCode={cutoffCode} compact /> : null}
      <OfflineBanner feature="Writer" fromCache={fromCache} cachedAt={cachedAt} />

      {error ? (
        <p className="telemetry-status" role="alert">
          {error}
        </p>
      ) : null}

      {!view ? (
        fetchFailed ? (
        <section className="app-card soft-panel writer-setup" role="status">
          {errorCopy.badge ? <span className="app-badge setup">{errorCopy.badge}</span> : null}
          <h2>{errorCopy.title}</h2>
          <p className="app-muted">{errorCopy.description}</p>
          <Button variant="secondary" type="button" onClick={() => void load()}>
            Retry
          </Button>
        </section>
        ) : (
        <section className="app-card soft-panel" aria-busy>
          <h2>{loadingCopy.title}</h2>
          <p className="app-muted">{loadingCopy.description}</p>
        </section>
        )
      ) : view.status === "setup_required" ? (
        <EmptyState
          soft
          badge={setupCopy.badge ?? "Needs setup"}
          badgeTone="setup"
          title={view.message || setupCopy.title}
          description={setupCopy.description}
        >
          {setupPrimary ? (
            <Button as="a" variant="primary" href={setupPrimary.href}>
              {setupPrimary.label}
            </Button>
          ) : null}
        </EmptyState>
      ) : (
        <WriterWorkspace
          view={view}
          seasonControl={live && live.seasons.length > 0 ? (
              <label className="app-muted" style={{ display: "flex", gap: 6, alignItems: "center" }}>
                Season
                <select
                  value={season ?? live.seasonYear}
                  onChange={(event) => {
                    const next = Number(event.target.value);
                    setSeason(next);
                    load(next);
                  }}
                >
                  {live.seasons.map((year) => (
                    <option key={year} value={year}>
                      {year}
                    </option>
                  ))}
                </select>
              </label>
          ) : null}
          busy={busy}
          mutate={mutate}
          setView={setView}
          setError={setError}
          setBusy={setBusy}
          cutoffCode={cutoffCode}
          setCutoffCode={setCutoffCode}
          canManageProfile={canManageProfile}
        />
      )}
    </main>
  );
}

function WriterWorkspace({
  view,
  seasonControl,
  busy,
  mutate,
  setView,
  setError,
  setBusy,
  cutoffCode,
  setCutoffCode,
  canManageProfile,
}: {
  view: LiveView;
  seasonControl: ReactNode;
  busy: boolean;
  mutate: Mutate;
  setView: (view: WriterView) => void;
  setError: (message: string) => void;
  setBusy: (busy: boolean) => void;
  cutoffCode: string | null;
  setCutoffCode: (code: string | null) => void;
  canManageProfile: boolean;
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

  const hasMission = Boolean(liveProfile.mission?.trim());
  const hasAchievements = liveProfile.achievements.length > 0;

  return (
    <div className="writer-workspace">
      <ProfilePanel
        seasonControl={seasonControl}
        profile={profile}
        setProfile={setProfile}
        busy={busy}
        mutate={mutate}
        canManageProfile={canManageProfile}
        thinProfile={!hasMission || !hasAchievements}
      />
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
        cutoffCode={cutoffCode}
        setCutoffCode={setCutoffCode}
      />
      <WriterNextActions
        orgId={view.orgId}
        draftCount={view.drafts.length}
        hasMission={hasMission}
        hasAchievements={hasAchievements}
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
  seasonControl,
  setProfile,
  busy,
  mutate,
  canManageProfile,
  thinProfile,
}: {
  profile: ProfileForm;
  seasonControl: ReactNode;
  setProfile: (updater: (prev: ProfileForm) => ProfileForm) => void;
  busy: boolean;
  mutate: Mutate;
  canManageProfile: boolean;
  thinProfile: boolean;
}) {
  const set = (key: keyof ProfileForm) => (event: { target: { value: string } }) =>
    setProfile((prev) => ({ ...prev, [key]: event.target.value }));

  return (
    <details className="app-card soft-panel writer-profile">
      <summary><span><strong>Team profile</strong><small>{thinProfile ? "Add your mission and achievements to personalize drafts" : "Your facts, funding needs, and writing tone"}</small></span></summary>
      <div className="writer-profile-fields">
      {seasonControl}
      <p className="app-muted">{canManageProfile ? "Used when you create a draft. Save to reuse these facts next time." : "Edit for this draft. An owner or admin can save changes for the team."}</p>
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
      {canManageProfile ? (
        <div>
          <Button variant="secondary" type="button" disabled={busy} onClick={() => mutate({ action: "set-profile", teamName: profile.teamName || undefined, teamNumber: profile.teamNumber || undefined, region: profile.region || undefined, mission: profile.mission || undefined, achievements: profile.achievements || undefined, fundingNeed: profile.fundingNeed || undefined, fundingAskUsd: profile.fundingAskUsd || undefined, tone: profile.tone, }) }>
            Save profile
          </Button>
        </div>
      ) : null}
      </div>
    </details>
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
    baseUrlOrigin?: string | null;
    /** Which key paid for the call (org/hosted/…) — distinct from `source` above. */
    keySource?: string | null;
  };
};

type PitchErrorResponse = {
  error?: string;
  code?: string;
  status?: string;
  message?: string;
  steps?: Array<{ id: string; label: string; detail: string; href: string }>;
};

function isPitchResponse(data: PitchResponse | PitchErrorResponse): data is PitchResponse {
  return (
    "status" in data &&
    (data.status === "live" || data.status === "setup_required") &&
    "orgId" in data &&
    "seasonYear" in data
  );
}

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
  cutoffCode,
  setCutoffCode,
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
  cutoffCode: string | null;
  setCutoffCode: (code: string | null) => void;
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
  /** Set only for a real model draft — a template draft has no endpoint to name. */
  const [aiProvenance, setAiProvenance] = useState<{
    provider: string;
    modelId: string;
    baseUrlOrigin?: string | null;
    source?: string | null;
  } | null>(null);
  const [copied, setCopied] = useState(false);
  const [providerSetup, setProviderSetup] = useState(false);

  const isGrant = kind === "grant";

  const generate = () => {
    setCutoffCode(null);
    setProviderSetup(false);
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
    setAiProvenance(null);
    setCopied(false);
  };

  const generateWithAssistant = () => {
    if (busy) return;
    setBusy(true);
    setError("");
    setCutoffCode(null);
    setProviderSetup(false);
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
        const data = (await response.json()) as PitchResponse | PitchErrorResponse;
        if (!response.ok || !isPitchResponse(data) || data.status === "setup_required") {
          const cutoff = resolveCutoffErrorCode(response.status, {
            code: "code" in data ? data.code : undefined,
            error: "error" in data ? data.error : undefined,
          });
          if (cutoff) setCutoffCode(cutoff);
          if (("code" in data && data.code === "setup_required") || data.status === "setup_required") {
            setProviderSetup(true);
            setError("");
          } else if (!cutoff) {
            setError("error" in data && data.error ? data.error : "Ask AI draft failed.");
          }
          return;
        }
        setView(data);
        void persistWriterSnapshot(orgId, String(data.seasonYear), data);
        if (data.pitch) {
          setSubject(data.pitch.subject ?? "");
          setDraftBody(data.pitch.body);
          setDraftSource(data.pitch.source === "ai" ? "ai" : "template");
          // The endpoint/model moved to <ModelProvenance> below, so the badge no
          // longer repeats it. A template draft never gets provenance — nothing
          // generated it.
          setAiMeta(
            data.pitch.source === "ai"
              ? "Ask AI draft"
              : `Template + your team’s business facts · usage logged (${data.pitch.provider})`,
          );
          setAiProvenance(
            data.pitch.source === "ai"
              ? {
                  provider: data.pitch.provider,
                  modelId: data.pitch.model,
                  baseUrlOrigin: data.pitch.baseUrlOrigin ?? null,
                  source: data.pitch.keySource ?? null,
                }
              : null,
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
    <section className="app-card soft-panel writer-composer">
      <div className="writer-compose-form">
      <h2>Compose a draft</h2>
      {cutoffCode ? <UsageCutoffBanner orgId={orgId} errorCode={cutoffCode} compact /> : null}
      {providerSetup ? <ConnectAiNotice orgId={orgId} /> : null}
      <label className="writer-format">
        <span>What are you writing?</span>
        <select value={kind} onChange={(event) => setKind(event.target.value as DraftKind)}>
          {(["grant", ...EMAIL_KINDS] as DraftKind[]).map((option) => <option key={option} value={option}>{kindLabel(option)}</option>)}
        </select>
      </label>
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
        <div className="writer-email-fields">
          <div className="writer-field-grid">
            <label><span>Sponsor / org name</span><input value={sponsorName} onChange={(event) => setSponsorName(event.target.value)} autoComplete="organization" /></label>
            <label><span>Contact name</span><input value={contactName} onChange={(event) => setContactName(event.target.value)} /></label>
            {["sponsorship_ask", "renewal", "grant_followup"].includes(kind) ? <label><span>Ask amount ($)</span><input type="number" min={0} value={askAmount} onChange={(event) => setAskAmount(event.target.value)} /></label> : null}
            {["renewal", "thank_you"].includes(kind) ? <label><span>Prior gift ($)</span><input type="number" min={0} value={priorAmount} onChange={(event) => setPriorAmount(event.target.value)} /></label> : null}
          </div>
          <details className="writer-more-details">
            <summary>Signature &amp; optional details</summary>
            <div className="writer-field-grid">
              <label><span>Your name</span><input value={senderName} onChange={(event) => setSenderName(event.target.value)} autoComplete="name" /></label>
              <label><span>Your role</span><input value={senderRole} onChange={(event) => setSenderRole(event.target.value)} placeholder="Team Captain" /></label>
              <label><span>Tier (optional)</span><input value={tier} onChange={(event) => setTier(event.target.value)} placeholder="Gold" /></label>
              {!["sponsorship_ask", "renewal", "grant_followup"].includes(kind) ? <label><span>Ask amount ($)</span><input type="number" min={0} value={askAmount} onChange={(event) => setAskAmount(event.target.value)} /></label> : null}
              {!["renewal", "thank_you"].includes(kind) ? <label><span>Prior gift ($)</span><input type="number" min={0} value={priorAmount} onChange={(event) => setPriorAmount(event.target.value)} /></label> : null}
            </div>
          </details>
        </div>
      )}

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <Button variant="primary" type="button" onClick={generate} disabled={busy}>
          Create draft
        </Button>
        <Button variant="secondary" type="button" onClick={generateWithAssistant} disabled={busy}>
          {busy ? "Drafting…" : "Draft with AI"}
        </Button>
        <small className="app-muted">Uses only your team profile and business records.</small>
      </div>

      </div>
      {draftBody ? (
        <div className="writer-draft-preview" >
          {draftSource ? (
            <span className={`app-badge ${draftSource === "ai" ? "good" : "muted"}`}>
              {draftSource === "ai" ? "AI draft" : "Template draft"}
              {aiMeta ? ` · ${aiMeta}` : ""}
            </span>
          ) : null}
          {draftSource === "ai" && aiProvenance ? (
            <ModelProvenance meta={aiProvenance} />
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
            <Button variant="secondary" type="button" onClick={copy}>
              {copied ? "Copied!" : "Copy"}
            </Button>
            <Button variant="primary" type="button" disabled={busy || !draftBody.trim()} onClick={() => mutate({ action: "save-draft", kind, title: `${kindLabel(kind)}${targetName && !isGrant ? ` — ${targetName}` : ""}`, targetName: targetName || undefined, subject: subject || undefined, body: draftBody, source: draftSource ?? "template", }) }>
              Save draft
            </Button>
            <small className="app-muted" style={{ alignSelf: "center" }}>
              Read this through before you send it.
            </small>
          </div>
        </div>
      ) : (
        <div className="writer-template-empty" role="status">
          <h3>Your draft will appear here</h3>
          <p>Choose a format, add the details, and create a draft.</p>
        </div>
      )}
    </section>
  );
}

function DraftLibrary({ view, busy, mutate }: { view: LiveView; busy: boolean; mutate: Mutate }) {
  if (view.drafts.length === 0) {
    const emptyCopy = writerShellCopy("empty");
    return (
      <section className="app-card soft-panel writer-drafts-empty">
        <h2>Saved drafts</h2>
        <p className="app-muted">{emptyCopy.description}</p>
        <WriterCrossLinks orgId={view.orgId} />
      </section>
    );
  }
  return (
    <section className="writer-drafts" style={{ display: "grid", gap: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
        <h2 style={{ margin: 0 }}>Saved drafts ({view.drafts.length})</h2>
        <WriterCrossLinks orgId={view.orgId} />
      </div>
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
    <article className="app-card soft-panel writer-draft-card">
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
