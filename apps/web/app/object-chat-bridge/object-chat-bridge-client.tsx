"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { EmptyState, FormGrid, FormRow, PageHeader, Panel } from "../../components/ui";
import { classifyLoadFailure, loadFailureCopy } from "../../lib/ui/load-failure";
import {
  OBJECT_CHAT_BRIDGE_OBJECT_TYPES,
  OBJECT_CHAT_BRIDGE_STATUSES,
  OBJECT_CHAT_BRIDGE_SUBTEAMS,
  objectTypeLabel,
  statusLabel,
  subteamLabel,
} from "../../lib/object-chat-bridge";
import type { ObjectChatBridgeView } from "../../lib/object-chat-bridge/compute-object-chat-bridge";
import type {
  ObjectChatBridgeLink,
  ObjectChatBridgeLinkStatus,
  ObjectChatBridgeObjectType,
  ObjectChatBridgeSubteam,
} from "../../lib/object-chat-bridge/types";

type LiveView = Extract<ObjectChatBridgeView, { status: "live" }>;

function statusTone(status: ObjectChatBridgeLinkStatus): string {
  if (status === "active") return "good";
  if (status === "resolved") return "setup";
  return "demo";
}

export default function ObjectChatBridgeClient() {
  const [view, setView] = useState<ObjectChatBridgeView | null>(null);
  const [error, setError] = useState("");
  const [fetchFailed, setFetchFailed] = useState(false);
  // Kept so an expired session offers sign-in instead of a Retry that cannot work.
  const [errorStatus, setErrorStatus] = useState<number | null>(null);
  const [loadError, setLoadError] = useState("");
  const [busy, setBusy] = useState(false);
  const [season, setSeason] = useState<number | null>(null);

  const orgId = view && "orgId" in view ? view.orgId : null;

  const load = useCallback((seasonOverride?: number) => {
    setFetchFailed(false);
    setErrorStatus(null);
    setLoadError("");
    setError("");
    const params = new URLSearchParams(window.location.search);
    const urlOrg = params.get("orgId");
    const seasonQuery = seasonOverride ?? (params.get("season") ? Number(params.get("season")) : null);
    const query = new URLSearchParams();
    if (urlOrg) query.set("orgId", urlOrg);
    if (seasonQuery) query.set("season", String(seasonQuery));
    void fetch(`/api/object-chat-bridge${query.toString() ? `?${query.toString()}` : ""}`)
      .then(async (response) => {
        const data = (await response.json()) as ObjectChatBridgeView | { error?: string };
        if (!response.ok || !("status" in data)) {
          setErrorStatus(response.status);
          setLoadError("error" in data && data.error ? data.error : "");
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

  const mutate = useCallback(
    async (payload: Record<string, unknown>) => {
      if (!orgId || busy) return;
      setBusy(true);
      setError("");
      try {
        const response = await fetch("/api/object-chat-bridge", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ orgId, seasonYear: season ?? undefined, ...payload }),
        });
        const data = (await response.json()) as ObjectChatBridgeView | { error?: string };
        if (!response.ok || !("status" in data)) {
          setError("error" in data && data.error ? data.error : "Something went wrong.");
          return;
        }
        setView(data);
        setSeason(data.seasonYear);
      } catch {
        setError("Network error — please try again.");
      } finally {
        setBusy(false);
      }
    },
    [orgId, season, busy],
  );

  return (
    <main className="module-page">
      <PageHeader
        breadcrumbs={
          <>
            <a href={orgId ? `/team?orgId=${encodeURIComponent(orgId)}` : "/team"}>Team</a>
            {" / Object Chat Bridge"}
          </>
        }
        title="Object Chat Bridge"
        description="Link a chat thread to a subsystem, order, or incident so the right subteam gets notified with context."
      >
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
      </PageHeader>

      {error ? (
        <p className="telemetry-status" role="alert">
          {error}
        </p>
      ) : null}

      {fetchFailed ? (
        (() => {
          const copy = loadFailureCopy(
            classifyLoadFailure({
              status: errorStatus,
              message: loadError,
              online: typeof navigator === "undefined" ? true : navigator.onLine,
            }),
            {
              nextPath:
                typeof window === "undefined"
                  ? null
                  : `${window.location.pathname}${window.location.search}`,
              message: loadError || "A network or server issue prevented loading. Try again.",
            },
          );
          return (
            <EmptyState title={copy.title} description={copy.description}>
              {copy.primary ? (
                <a className="app-button" href={copy.primary.href}>
                  {copy.primary.label}
                </a>
              ) : null}
              {copy.showRetry ? (
                <button type="button" className="app-button secondary" onClick={() => load()}>
                  Retry
                </button>
              ) : null}
            </EmptyState>
          );
        })()
      ) : view == null ? (
        <EmptyState title="Loading…" description="Checking your workspace." aria-busy />
      ) : view.status === "setup_required" ? (
        <EmptyState badge="Setup required" badgeTone="setup" title={view.message}>
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
        </EmptyState>
      ) : (
        <div style={{ display: "grid", gap: 16 }}>
          <SummaryTiles view={view} />
          <CreateLinkForm busy={busy} mutate={mutate} />
          <LinksList view={view} busy={busy} mutate={mutate} />
        </div>
      )}
    </main>
  );
}

function SummaryTiles({ view }: { view: LiveView }) {
  const { summary } = view;
  const tiles = [
    { label: "Links", value: String(summary.totalLinks) },
    { label: "Active", value: String(summary.activeLinks) },
    { label: "Resolved", value: String(summary.resolvedLinks) },
    { label: "Notifications", value: String(summary.totalNotifications) },
    { label: "Unacknowledged", value: String(summary.unacknowledgedNotifications) },
  ];
  return (
    <Panel>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: 12 }}>
        {tiles.map((tile) => (
          <div key={tile.label}>
            <strong style={{ fontSize: "1.6rem", display: "block" }}>{tile.value}</strong>
            <span className="app-muted">{tile.label}</span>
          </div>
        ))}
      </div>
    </Panel>
  );
}

function LinksList({
  view,
  busy,
  mutate,
}: {
  view: LiveView;
  busy: boolean;
  mutate: (payload: Record<string, unknown>) => void;
}) {
  if (view.links.length === 0) {
    return (
      <EmptyState
        badge="No links yet"
        badgeTone="setup"
        title="Link your first chat thread"
        description="Tie a thread to a subsystem, order, or incident so the right subteam sees the context."
      />
    );
  }
  return (
    <Panel>
      <h2 style={{ marginTop: 0 }}>Linked threads</h2>
      <ul style={{ listStyle: "none", padding: 0, display: "grid", gap: 14 }}>
        {view.links.map((link) => (
          <LinkRowItem key={link.id} link={link} busy={busy} mutate={mutate} />
        ))}
      </ul>
    </Panel>
  );
}

function LinkRowItem({
  link,
  busy,
  mutate,
}: {
  link: ObjectChatBridgeLink;
  busy: boolean;
  mutate: (payload: Record<string, unknown>) => void;
}) {
  const [message, setMessage] = useState("");
  const [notifiedSubteam, setNotifiedSubteam] = useState<ObjectChatBridgeSubteam>(link.subteam);

  return (
    <li style={{ display: "grid", gap: 8, borderTop: "1px solid var(--app-border, #333)", paddingTop: 10 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
        <div>
          <span className={`app-badge ${statusTone(link.status)}`}>{statusLabel(link.status)}</span>
          <strong style={{ marginLeft: 8 }}>
            {objectTypeLabel(link.objectType)}: {link.objectRef}
            {link.objectLabel ? ` (${link.objectLabel})` : ""}
          </strong>
          <small className="app-muted" style={{ display: "block" }}>
            Thread {link.threadRef} · {subteamLabel(link.subteam)} · {link.createdAt.slice(0, 10)}
          </small>
          {link.context ? <p style={{ margin: "4px 0 0" }}>{link.context}</p> : null}
        </div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "flex-start" }}>
          {OBJECT_CHAT_BRIDGE_STATUSES.filter((status) => status !== link.status).map((status) => (
            <button
              key={status}
              type="button"
              className="app-button secondary"
              disabled={busy}
              onClick={() => mutate({ action: "update-status", linkId: link.id, status })}
            >
              Mark {statusLabel(status)}
            </button>
          ))}
          <button
            type="button"
            className="text-button"
            disabled={busy}
            onClick={() => {
              if (window.confirm(`Delete link for "${link.objectRef}"?`)) {
                mutate({ action: "delete-link", linkId: link.id });
              }
            }}
          >
            Delete
          </button>
        </div>
      </div>

      {link.notifications.length > 0 ? (
        <ul style={{ listStyle: "none", padding: 0, display: "grid", gap: 6 }}>
          {link.notifications.map((notification) => (
            <li
              key={notification.id}
              style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "flex-start" }}
            >
              <div>
                <small className="app-muted">
                  {subteamLabel(notification.notifiedSubteam)} · {notification.createdAt.slice(0, 10)}
                  {notification.acknowledged ? " · acknowledged" : ""}
                </small>
                <p style={{ margin: 0 }}>{notification.message}</p>
              </div>
              {!notification.acknowledged ? (
                <button
                  type="button"
                  className="app-button secondary"
                  disabled={busy}
                  onClick={() => mutate({ action: "acknowledge-notification", notificationId: notification.id })}
                >
                  Acknowledge
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}

      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (!message.trim()) return;
          mutate({ action: "notify-subteam", linkId: link.id, notifiedSubteam, message });
          setMessage("");
        }}
        style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}
      >
        <select value={notifiedSubteam} onChange={(event) => setNotifiedSubteam(event.target.value as ObjectChatBridgeSubteam)}>
          {OBJECT_CHAT_BRIDGE_SUBTEAMS.map((subteam) => (
            <option key={subteam} value={subteam}>
              {subteamLabel(subteam)}
            </option>
          ))}
        </select>
        <input
          value={message}
          onChange={(event) => setMessage(event.target.value)}
          placeholder="Notify with context…"
          style={{ flex: 1, minWidth: 200 }}
        />
        <button type="submit" className="app-button" disabled={busy || !message.trim()}>
          Notify
        </button>
      </form>
    </li>
  );
}

function CreateLinkForm({
  busy,
  mutate,
}: {
  busy: boolean;
  mutate: (payload: Record<string, unknown>) => void;
}) {
  const empty = useMemo(
    () => ({
      objectType: "subsystem" as ObjectChatBridgeObjectType,
      objectRef: "",
      objectLabel: "",
      threadRef: "",
      subteam: "mechanical" as ObjectChatBridgeSubteam,
      context: "",
    }),
    [],
  );
  const [form, setForm] = useState(empty);
  const set = (key: keyof typeof form) => (event: { target: { value: string } }) =>
    setForm((prev) => ({ ...prev, [key]: event.target.value }));

  return (
    <Panel
      as="form"
      onSubmit={(event) => {
        event.preventDefault();
        if (!form.objectRef.trim() || !form.threadRef.trim()) return;
        mutate({
          action: "create-link",
          objectType: form.objectType,
          objectRef: form.objectRef,
          objectLabel: form.objectLabel || undefined,
          threadRef: form.threadRef,
          subteam: form.subteam,
          context: form.context || undefined,
        });
        setForm(empty);
      }}
      style={{ display: "grid", gap: 10 }}
    >
      <h2 style={{ margin: 0 }}>Link a thread</h2>
      <FormGrid min={160}>
        <FormRow label="Object type">
          <select value={form.objectType} onChange={set("objectType")}>
            {OBJECT_CHAT_BRIDGE_OBJECT_TYPES.map((type) => (
              <option key={type} value={type}>
                {objectTypeLabel(type)}
              </option>
            ))}
          </select>
        </FormRow>
        <FormRow label="Object reference">
          <input value={form.objectRef} onChange={set("objectRef")} placeholder="Intake, PO-4821, INC-12" required />
        </FormRow>
        <FormRow label="Object label (optional)">
          <input value={form.objectLabel} onChange={set("objectLabel")} placeholder="Intake roller mount" />
        </FormRow>
        <FormRow label="Chat thread">
          <input value={form.threadRef} onChange={set("threadRef")} placeholder="#build-intake" required />
        </FormRow>
        <FormRow label="Notify subteam">
          <select value={form.subteam} onChange={set("subteam")}>
            {OBJECT_CHAT_BRIDGE_SUBTEAMS.map((subteam) => (
              <option key={subteam} value={subteam}>
                {subteamLabel(subteam)}
              </option>
            ))}
          </select>
        </FormRow>
      </FormGrid>
      <FormRow label="Context (optional)">
        <textarea value={form.context} onChange={set("context")} rows={2} />
      </FormRow>
      <div>
        <button type="submit" className="app-button" disabled={busy || !form.objectRef.trim() || !form.threadRef.trim()}>
          Create link
        </button>
      </div>
    </Panel>
  );
}
