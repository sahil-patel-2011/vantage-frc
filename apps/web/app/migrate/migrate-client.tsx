"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
// Subpath imports, not the package barrel: the barrel re-exports parsers that
// use node:crypto, which must not be pulled into the browser bundle.
import {
  CONNECTORS,
  connectorById,
  type ConnectorDescriptor,
  type ConnectorId,
} from "@vantage/import/connectors";
import type { ColumnSuggestion } from "@vantage/import/presets";
import { EmptyState, FormGrid, FormRow, PageHeader, Panel } from "../../components/ui";
import type { MigrateView } from "../../lib/migrate/compute-migrate";
import { withOrgHref } from "../../lib/nav/product-nav";
import { IMPORTED_FORM_DRAFT_KEY } from "../../lib/scouting/form-builder";
import { classifyLoadFailure, loadFailureCopy } from "../../lib/ui/load-failure";

type Skip = { ref: string; reason: string };
type Issue = { ref: string; message: string };

type ScoutReport = {
  written: number;
  duplicates: number;
  unmappedFields: string[];
  rejected: Skip[];
  skipped: Skip[];
  errors: Issue[];
};

type TrelloList = { listId: string; listName: string; suggested: string; cardCount: number };

type PresetRow = { id: string; connector: string; name: string; columns: Record<string, string> };

type MigrateResponse = MigrateView & {
  error?: string;
  expected?: string;
  drafts?: Array<Record<string, unknown>>;
  headers?: string[];
  written?: number;
  counts?: { calendar?: number; knowledge?: number; tasks?: number };
  report?: ScoutReport & { skipped?: Skip[]; errors?: Issue[] };
  skipped?: Skip[];
  errors?: Issue[];
  definition?: { title: string; fields: Array<{ key: string; label: string; type: string }> } | null;
  lists?: TrelloList[];
  statuses?: string[];
  boardName?: string;
  invites?: { invited: number; failed: Array<{ email: string; reason: string }>; emailsSent: number };
  presets?: PresetRow[];
  preset?: PresetRow;
  mapping?: {
    headers: string[];
    columns: ColumnSuggestion[];
    preset: { id: string; name: string } | null;
    missingHeaders: string[];
    unknownHeaders: string[];
    presets: PresetRow[];
  };
};

const CATEGORY_LABELS: Record<ConnectorDescriptor["category"], string> = {
  scouting: "Scouting",
  calendar: "Calendar",
  tasks: "Tasks",
  people: "People and hours",
  notes: "Notes",
};

const CATEGORY_ORDER: Array<ConnectorDescriptor["category"]> = [
  "scouting",
  "calendar",
  "tasks",
  "people",
  "notes",
];

/** Rows the parser declined, always shown — an import that drops rows silently is a bug. */
function ReviewNotes({ skipped, errors }: { skipped?: Skip[]; errors?: Issue[] }) {
  if (!skipped?.length && !errors?.length) return null;
  return (
    <div className="migrate-notes">
      {errors?.length ? (
        <details open>
          <summary>
            {errors.length} row{errors.length === 1 ? "" : "s"} could not be read
          </summary>
          <ul>
            {errors.map((issue, index) => (
              <li key={`${issue.ref}-${index}`}>
                <b>{issue.ref}</b> — {issue.message}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
      {skipped?.length ? (
        <details>
          <summary>
            {skipped.length} item{skipped.length === 1 ? "" : "s"} not imported, and why
          </summary>
          <ul>
            {skipped.map((skip, index) => (
              <li key={`${skip.ref}-${index}`}>
                <b>{skip.ref}</b> — {skip.reason}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}

function ScoutReportView({ report }: { report: ScoutReport }) {
  return (
    <div className="migrate-report">
      <p className="migrate-preview">
        {report.written} entr{report.written === 1 ? "y" : "ies"} imported
        {report.duplicates ? ` · ${report.duplicates} already imported (unchanged)` : ""}
      </p>
      {report.unmappedFields.length ? (
        <p className="migrate-warn">
          {report.unmappedFields.length} field
          {report.unmappedFields.length === 1 ? " is" : "s are"} not on your scouting form, so
          {report.unmappedFields.length === 1 ? " it was" : " they were"} not stored:{" "}
          <code>{report.unmappedFields.join(", ")}</code>. Add
          {report.unmappedFields.length === 1 ? " it" : " them"} to your form, then import again.
        </p>
      ) : null}
      <ReviewNotes
        skipped={[...(report.skipped ?? []), ...report.rejected]}
        errors={report.errors}
      />
    </div>
  );
}

export default function MigrateClient() {
  const [view, setView] = useState<MigrateView | null>(null);
  const [error, setError] = useState("");
  const [expected, setExpected] = useState("");
  const [loadFailed, setLoadFailed] = useState(false);
  // Kept so an expired session offers sign-in instead of a Retry that cannot work.
  const [errorStatus, setErrorStatus] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [connector, setConnector] = useState<ConnectorId | null>(null);
  const [icsUrl, setIcsUrl] = useState("");
  const [icsPaste, setIcsPaste] = useState("");
  const [csvPaste, setCsvPaste] = useState("");
  const [hoursPaste, setHoursPaste] = useState("");
  const [notionPaste, setNotionPaste] = useState("");
  const [filePaste, setFilePaste] = useState("");
  const [configPaste, setConfigPaste] = useState("");
  const [eventKey, setEventKey] = useState("");
  const [preview, setPreview] = useState("");
  const [result, setResult] = useState<MigrateResponse | null>(null);
  const [listStatus, setListStatus] = useState<Record<string, string>>({});
  const [selectedEmails, setSelectedEmails] = useState<Record<string, boolean>>({});
  const [inviteRole, setInviteRole] = useState("scout");
  const [sendInviteEmail, setSendInviteEmail] = useState(false);
  const [presetName, setPresetName] = useState("");
  const [columnMap, setColumnMap] = useState<Record<string, string>>({});

  const load = useCallback(() => {
    const orgId = new URLSearchParams(window.location.search).get("orgId");
    const query = orgId ? `?orgId=${encodeURIComponent(orgId)}` : "";
    void fetch(`/api/migrate${query}`)
      .then(async (response) => {
        const data = (await response.json()) as MigrateView | { error?: string };
        if (!response.ok || !("status" in data)) {
          setError("error" in data && data.error ? data.error : "Could not load the switching kit.");
          setErrorStatus(response.status);
          setLoadFailed(true);
          return;
        }
        setErrorStatus(null);
        setLoadFailed(false);
        setView(data);
      })
      .catch(() => {
        setError("Network error — please try again.");
        setLoadFailed(true);
      });
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const orgId = view && "orgId" in view ? view.orgId : null;
  const selected = connector ? connectorById(connector) : undefined;

  const grouped = useMemo(
    () =>
      CATEGORY_ORDER.map((category) => ({
        category,
        items: CONNECTORS.filter((item) => item.category === category),
      })).filter((group) => group.items.length),
    [],
  );

  async function post(payload: Record<string, unknown>) {
    if (!orgId) return;
    setError("");
    setExpected("");
    setBusy(true);
    try {
      const response = await fetch("/api/migrate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ orgId, ...payload }),
      });
      const data = (await response.json()) as MigrateResponse;
      if (!response.ok) {
        setError(data.error ? data.error : "Import failed.");
        setExpected(data.expected ?? "");
        setResult(null);
        return;
      }
      if ("status" in data) setView(data);
      setResult(data);
      if (Array.isArray(data.drafts)) {
        setPreview(`${data.drafts.length} row${data.drafts.length === 1 ? "" : "s"} ready to import`);
      }
      if (Array.isArray(data.headers)) setPreview(`CSV columns: ${data.headers.join(", ")}`);
      if (typeof data.written === "number") setPreview(`${data.written} rows written`);
      if (data.counts) {
        setPreview(
          `Calendar ${data.counts.calendar ?? 0} · Knowledge ${data.counts.knowledge ?? 0} · Tasks ${data.counts.tasks ?? 0}`,
        );
      }
      if (data.lists) {
        setListStatus((current) => {
          const next = { ...current };
          for (const list of data.lists!) next[list.listId] ??= list.suggested;
          return next;
        });
      }
      if (data.mapping) {
        setColumnMap(
          Object.fromEntries(data.mapping.columns.map((column) => [column.header, column.target])),
        );
      }
      if (data.drafts && connector === "stims") {
        setSelectedEmails(
          Object.fromEntries(
            data.drafts
              .map((draft) => draft.email)
              .filter((email): email is string => typeof email === "string")
              .map((email) => [email, true]),
          ),
        );
      }
    } catch {
      setError("Network error — please try again.");
    } finally {
      setBusy(false);
    }
  }

  function pickConnector(id: ConnectorId) {
    setConnector(id);
    setError("");
    setExpected("");
    setPreview("");
    setResult(null);
    setFilePaste("");
    setConfigPaste("");
    setListStatus({});
    setSelectedEmails({});
    setColumnMap({});
  }

  const inviteDrafts = (result?.drafts ?? []) as Array<{ email?: string; personName?: string }>;
  const checkedEmails = Object.entries(selectedEmails)
    .filter(([, checked]) => checked)
    .map(([email]) => email);

  return (
    <main className="module-page migrate-page">
      <PageHeader
        breadcrumbs={
          <>
            <a href={orgId ? `/team?orgId=${encodeURIComponent(orgId)}` : "/team"}>Team</a>
            {" / Bring your season"}
          </>
        }
        title="Bring your season"
        description="Pick one source, preview the rows, then import. Keep the old tool running until you have checked the result."
      />
      {loadFailed ? (
        (() => {
          const copy = loadFailureCopy(
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
      ) : error ? (
        <p className="migrate-error">
          {error}
          {expected ? <small>Expected {expected}</small> : null}
        </p>
      ) : null}
      {view?.status === "setup_required" ? (
        <EmptyState title="Workspace required" description={view.message} />
      ) : null}
      {view?.status === "live" ? (
        <>
          <ol className="migrate-steps" aria-label="Import steps">
            <li className={connector ? "done" : "current"}>
              <b>1</b>
              Choose source
            </li>
            <li className={connector ? "current" : "upcoming"}>
              <b>2</b>
              Preview, then import
            </li>
          </ol>

          {!connector ? (
            <section aria-label="Where is your data today?" className="migrate-sources">
              <h2 className="migrate-sources-title">Where is your data today?</h2>
              {grouped.map((group) => (
                <div key={group.category} className="migrate-group">
                  <h3>{CATEGORY_LABELS[group.category]}</h3>
                  <div className="migrate-picker">
                    {group.items.map((item) =>
                      item.unsupported ? (
                        <div key={item.id} className="migrate-tile unsupported">
                          <strong>{item.title}</strong>
                          <span>From {item.from}</span>
                          <small className="migrate-unsupported">{item.unsupported}</small>
                          {item.docsUrl ? (
                            <a href={item.docsUrl} target="_blank" rel="noreferrer noopener">
                              Open {item.title}
                            </a>
                          ) : null}
                        </div>
                      ) : (
                        <button
                          key={item.id}
                          type="button"
                          className="migrate-tile"
                          onClick={() => pickConnector(item.id)}
                        >
                          <strong>{item.title}</strong>
                          <span>From {item.from}</span>
                          <small>
                            <b>File:</b> {item.fileType}
                          </small>
                          <small>
                            <b>Into:</b> {item.into}
                          </small>
                        </button>
                      ),
                    )}
                  </div>
                </div>
              ))}
            </section>
          ) : (
            <Panel>
              <header className="migrate-panel-head">
                <div>
                  <h2>{selected?.title}</h2>
                  <p className="app-muted">
                    From {selected?.from}. Imports into {selected?.into}.
                  </p>
                  {selected?.howToExport ? (
                    <p className="app-muted migrate-how">{selected.howToExport}</p>
                  ) : null}
                </div>
                <button type="button" className="app-button secondary" onClick={() => setConnector(null)}>
                  Change source
                </button>
              </header>

              {connector === "ics" ? (
                <>
                  <FormGrid>
                    <FormRow label="ICS URL">
                      <input
                        value={icsUrl}
                        onChange={(event) => setIcsUrl(event.target.value)}
                        placeholder="https://…"
                      />
                    </FormRow>
                  </FormGrid>
                  <div className="migrate-actions">
                    <button
                      type="button"
                      className="app-button"
                      disabled={busy || !icsUrl.trim()}
                      onClick={() => void post({ action: "connect-ics", icsUrl })}
                    >
                      Save feed
                    </button>
                    <button
                      type="button"
                      className="app-button secondary"
                      disabled={busy || !icsUrl.trim()}
                      onClick={() => void post({ action: "sync-ics", icsUrl })}
                    >
                      Pull now
                    </button>
                  </div>
                  <FormRow label="Or paste .ics">
                    <textarea value={icsPaste} onChange={(event) => setIcsPaste(event.target.value)} rows={8} />
                  </FormRow>
                  <div className="migrate-actions">
                    <button
                      type="button"
                      className="app-button"
                      disabled={busy || !icsPaste.trim()}
                      onClick={() => void post({ action: "commit-ics", content: icsPaste })}
                    >
                      Import into calendar
                    </button>
                    <button
                      type="button"
                      className="app-button secondary"
                      disabled={busy || !icsPaste.trim()}
                      onClick={() => void post({ action: "preview-ics", content: icsPaste })}
                    >
                      Preview
                    </button>
                  </div>
                  {view.inboundFeeds.length ? (
                    <ul className="migrate-feeds">
                      {view.inboundFeeds.map((feed) => (
                        <li key={feed.id}>{feed.icsUrl}</li>
                      ))}
                    </ul>
                  ) : null}
                  <p>
                    <a href={withOrgHref("/team/calendar", view.orgId)}>Open Calendar</a>
                  </p>
                </>
              ) : null}

              {connector === "scout" ? (
                <>
                  <FormRow label="Paste CSV header + rows">
                    <textarea value={csvPaste} onChange={(event) => setCsvPaste(event.target.value)} rows={8} />
                  </FormRow>
                  <p className="app-muted">
                    Rows need event key + team number. Free-text scout names are stripped. Missing TBA event years are
                    skipped.
                  </p>
                  {result?.mapping ? (
                    <div className="migrate-mapping">
                      <h3>Column mapping</h3>
                      <p className="app-muted">
                        These are suggestions. Check each one — nothing is imported until you press Import.
                      </p>
                      {result.mapping.missingHeaders.length ? (
                        <p className="migrate-warn">
                          The preset expected columns this file does not have:{" "}
                          <code>{result.mapping.missingHeaders.join(", ")}</code>
                        </p>
                      ) : null}
                      <ul className="migrate-columns">
                        {result.mapping.columns.map((column) => (
                          <li key={column.header}>
                            <label htmlFor={`col-${column.header}`}>{column.header}</label>
                            <select
                              id={`col-${column.header}`}
                              value={columnMap[column.header] ?? column.target}
                              onChange={(event) =>
                                setColumnMap((current) => ({
                                  ...current,
                                  [column.header]: event.target.value,
                                }))
                              }
                            >
                              {["ignore", "event_key", "match_key", "team_key", "person", "hours", "date"].map(
                                (target) => (
                                  <option key={target} value={target}>
                                    {target}
                                  </option>
                                ),
                              )}
                            </select>
                            <small className={`migrate-confidence ${column.confidence}`}>
                              {column.confidence === "exact" ? "" : `${column.confidence}: `}
                              {column.reason}
                            </small>
                          </li>
                        ))}
                      </ul>
                      <FormRow label="Save this mapping as a preset">
                        <input
                          value={presetName}
                          onChange={(event) => setPresetName(event.target.value)}
                          placeholder="Week 1 sheet"
                        />
                      </FormRow>
                      <div className="migrate-actions">
                        <button
                          type="button"
                          className="app-button secondary"
                          disabled={busy || !presetName.trim()}
                          onClick={() =>
                            void post({
                              action: "save-preset",
                              connector: "scout",
                              name: presetName,
                              columns: columnMap,
                            })
                          }
                        >
                          Save preset
                        </button>
                      </div>
                    </div>
                  ) : null}
                  {result?.mapping?.presets?.length ? (
                    <div className="migrate-presets">
                      <h3>Saved presets</h3>
                      <ul>
                        {result.mapping.presets.map((item) => (
                          <li key={item.id}>
                            <button
                              type="button"
                              className="app-button secondary"
                              disabled={busy || !csvPaste.trim()}
                              onClick={() =>
                                void post({
                                  action: "preview-csv-mapping",
                                  connector: "scout",
                                  content: csvPaste,
                                  presetId: item.id,
                                })
                              }
                            >
                              Apply “{item.name}”
                            </button>
                            <button
                              type="button"
                              className="app-button secondary"
                              disabled={busy}
                              onClick={() => void post({ action: "delete-preset", presetId: item.id })}
                            >
                              Delete
                            </button>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                  <div className="migrate-actions">
                    <button
                      type="button"
                      className="app-button"
                      disabled={busy || !csvPaste.trim()}
                      onClick={() => void post({ action: "commit-scout-csv", content: csvPaste })}
                    >
                      Import scouting rows
                    </button>
                    <button
                      type="button"
                      className="app-button secondary"
                      disabled={busy || !csvPaste.trim()}
                      onClick={() =>
                        void post({ action: "preview-csv-mapping", connector: "scout", content: csvPaste })
                      }
                    >
                      Detect columns
                    </button>
                  </div>
                </>
              ) : null}

              {connector === "hours" ? (
                <>
                  <FormRow label="Paste person, hours, and date columns">
                    <textarea value={hoursPaste} onChange={(event) => setHoursPaste(event.target.value)} rows={8} />
                  </FormRow>
                  <div className="migrate-actions">
                    <button
                      type="button"
                      className="app-button"
                      disabled={busy || !hoursPaste.trim()}
                      onClick={() => void post({ action: "commit-hours-csv", content: hoursPaste })}
                    >
                      Import attendance hours
                    </button>
                  </div>
                  <p>
                    <a href={withOrgHref("/attendance", view.orgId)}>Open Attendance</a>
                    {" · "}
                    <a href={withOrgHref("/hours", view.orgId)}>Open shop hours</a>
                  </p>
                </>
              ) : null}

              {connector === "purple_standard" ? (
                <>
                  <FormGrid>
                    <FormRow label="Event key (optional filter)">
                      <input
                        value={eventKey}
                        onChange={(event) => setEventKey(event.target.value)}
                        placeholder="2025mokc"
                      />
                    </FormRow>
                  </FormGrid>
                  <FormRow label="Paste Purple Standard JSON">
                    <textarea value={filePaste} onChange={(event) => setFilePaste(event.target.value)} rows={10} />
                  </FormRow>
                  <div className="migrate-actions">
                    <button
                      type="button"
                      className="app-button"
                      disabled={busy || !filePaste.trim()}
                      onClick={() =>
                        void post({ action: "commit-purple-standard", content: filePaste, eventKey })
                      }
                    >
                      Import scouting entries
                    </button>
                    <button
                      type="button"
                      className="app-button secondary"
                      disabled={busy || !filePaste.trim()}
                      onClick={() =>
                        void post({ action: "preview-purple-standard", content: filePaste, eventKey })
                      }
                    >
                      Preview
                    </button>
                  </div>
                </>
              ) : null}

              {connector === "qrscout_form" ? (
                <>
                  <FormRow label="Paste QRScout config.json">
                    <textarea value={configPaste} onChange={(event) => setConfigPaste(event.target.value)} rows={10} />
                  </FormRow>
                  <div className="migrate-actions">
                    <button
                      type="button"
                      className="app-button"
                      disabled={busy || !configPaste.trim()}
                      onClick={() => void post({ action: "preview-qrscout-form", content: configPaste })}
                    >
                      Build form draft
                    </button>
                  </div>
                  {result?.definition ? (
                    <div className="migrate-form-draft">
                      <h3>{result.definition.title}</h3>
                      <p className="app-muted">
                        {result.definition.fields.length} field
                        {result.definition.fields.length === 1 ? "" : "s"}. This is an UNPUBLISHED draft — copy it into
                        the form builder to review and publish. Nothing has been written to your live form.
                      </p>
                      <ul className="migrate-fields">
                        {result.definition.fields.map((field) => (
                          <li key={field.key}>
                            <b>{field.label}</b> <code>{field.type}</code>
                          </li>
                        ))}
                      </ul>
                      <FormRow label="Form draft JSON">
                        <textarea readOnly rows={8} value={JSON.stringify(result.definition, null, 2)} />
                      </FormRow>
                      <p>
                        <button
                          type="button"
                          className="app-button"
                          onClick={() => {
                            try {
                              window.sessionStorage.setItem(
                                IMPORTED_FORM_DRAFT_KEY,
                                JSON.stringify(result.definition),
                              );
                            } catch {
                              // Storage blocked: the textarea above stays the manual path.
                            }
                            window.location.href = withOrgHref("/scouting/forms", view.orgId);
                          }}
                        >
                          Open in the form builder
                        </button>
                      </p>
                    </div>
                  ) : null}
                </>
              ) : null}

              {connector === "qrscout_entries" ? (
                <>
                  <FormGrid>
                    <FormRow label="Event key">
                      <input
                        value={eventKey}
                        onChange={(event) => setEventKey(event.target.value)}
                        placeholder="2025mokc"
                      />
                    </FormRow>
                  </FormGrid>
                  <FormRow label="The config.json these codes were made with">
                    <textarea value={configPaste} onChange={(event) => setConfigPaste(event.target.value)} rows={6} />
                  </FormRow>
                  <FormRow label="Scanned QR payload lines (one per scan)">
                    <textarea value={filePaste} onChange={(event) => setFilePaste(event.target.value)} rows={8} />
                  </FormRow>
                  <div className="migrate-actions">
                    <button
                      type="button"
                      className="app-button"
                      disabled={busy || !filePaste.trim() || !configPaste.trim() || !eventKey.trim()}
                      onClick={() =>
                        void post({
                          action: "commit-qrscout-entries",
                          configContent: configPaste,
                          payloadContent: filePaste,
                          eventKey,
                        })
                      }
                    >
                      Import scans
                    </button>
                    <button
                      type="button"
                      className="app-button secondary"
                      disabled={busy || !filePaste.trim() || !configPaste.trim()}
                      onClick={() =>
                        void post({
                          action: "preview-qrscout-entries",
                          configContent: configPaste,
                          payloadContent: filePaste,
                          eventKey,
                        })
                      }
                    >
                      Preview
                    </button>
                  </div>
                </>
              ) : null}

              {connector === "scoutradioz" ? (
                <>
                  <FormGrid>
                    <FormRow label="Event key (optional filter)">
                      <input
                        value={eventKey}
                        onChange={(event) => setEventKey(event.target.value)}
                        placeholder="2025mokc"
                      />
                    </FormRow>
                  </FormGrid>
                  <FormRow label="Paste the Scoutradioz raw export JSON">
                    <textarea value={filePaste} onChange={(event) => setFilePaste(event.target.value)} rows={10} />
                  </FormRow>
                  <div className="migrate-actions">
                    <button
                      type="button"
                      className="app-button"
                      disabled={busy || !filePaste.trim()}
                      onClick={() => void post({ action: "commit-scoutradioz", content: filePaste, eventKey })}
                    >
                      Import scouting entries
                    </button>
                    <button
                      type="button"
                      className="app-button secondary"
                      disabled={busy || !filePaste.trim()}
                      onClick={() => void post({ action: "preview-scoutradioz", content: filePaste, eventKey })}
                    >
                      Preview
                    </button>
                  </div>
                </>
              ) : null}

              {connector === "trello" ? (
                <>
                  <FormRow label="Paste the board JSON">
                    <textarea value={filePaste} onChange={(event) => setFilePaste(event.target.value)} rows={8} />
                  </FormRow>
                  <div className="migrate-actions">
                    <button
                      type="button"
                      className="app-button secondary"
                      disabled={busy || !filePaste.trim()}
                      onClick={() => void post({ action: "preview-trello-lists", content: filePaste })}
                    >
                      Read lists
                    </button>
                  </div>
                  {result?.lists?.length ? (
                    <div className="migrate-mapping">
                      <h3>Map each Trello list to a task status</h3>
                      <ul className="migrate-columns">
                        {result.lists.map((list) => (
                          <li key={list.listId}>
                            <label htmlFor={`list-${list.listId}`}>
                              {list.listName} <small>({list.cardCount} cards)</small>
                            </label>
                            <select
                              id={`list-${list.listId}`}
                              value={listStatus[list.listId] ?? list.suggested}
                              onChange={(event) =>
                                setListStatus((current) => ({ ...current, [list.listId]: event.target.value }))
                              }
                            >
                              {(result.statuses ?? []).map((status) => (
                                <option key={status} value={status}>
                                  {status}
                                </option>
                              ))}
                            </select>
                          </li>
                        ))}
                      </ul>
                      <p className="app-muted">
                        Checklists become a checklist in the task notes — Vantage tasks have no subtasks. Due dates are
                        kept.
                      </p>
                      <div className="migrate-actions">
                        <button
                          type="button"
                          className="app-button"
                          disabled={busy}
                          onClick={() =>
                            void post({ action: "commit-trello", content: filePaste, listStatus })
                          }
                        >
                          Import tasks
                        </button>
                        <button
                          type="button"
                          className="app-button secondary"
                          disabled={busy}
                          onClick={() =>
                            void post({ action: "preview-trello-cards", content: filePaste, listStatus })
                          }
                        >
                          Preview cards
                        </button>
                      </div>
                    </div>
                  ) : null}
                  <p>
                    <a href={withOrgHref("/tasks", view.orgId)}>Open Tasks</a>
                  </p>
                </>
              ) : null}

              {connector === "stims" ? (
                <>
                  <FormRow label="Paste the roster CSV">
                    <textarea value={filePaste} onChange={(event) => setFilePaste(event.target.value)} rows={8} />
                  </FormRow>
                  <div className="migrate-actions">
                    <button
                      type="button"
                      className="app-button secondary"
                      disabled={busy || !filePaste.trim()}
                      onClick={() => void post({ action: "preview-stims", content: filePaste })}
                    >
                      Read roster
                    </button>
                  </div>
                  {inviteDrafts.length ? (
                    <div className="migrate-mapping">
                      <h3>Review before anything is sent</h3>
                      <p className="app-muted">
                        Nothing has been emailed. Untick anyone who should not get an invite.
                      </p>
                      <ul className="migrate-invites">
                        {inviteDrafts.map((draft) => (
                          <li key={draft.email}>
                            <label>
                              <input
                                type="checkbox"
                                checked={selectedEmails[draft.email ?? ""] ?? false}
                                onChange={(event) =>
                                  setSelectedEmails((current) => ({
                                    ...current,
                                    [draft.email ?? ""]: event.target.checked,
                                  }))
                                }
                              />
                              <span>
                                <b>{draft.personName}</b> {draft.email}
                              </span>
                            </label>
                          </li>
                        ))}
                      </ul>
                      <FormGrid>
                        <FormRow label="Role">
                          <select value={inviteRole} onChange={(event) => setInviteRole(event.target.value)}>
                            <option value="scout">scout</option>
                            <option value="viewer">viewer</option>
                            <option value="admin">admin</option>
                          </select>
                        </FormRow>
                      </FormGrid>
                      <label className="migrate-check">
                        <input
                          type="checkbox"
                          checked={sendInviteEmail}
                          onChange={(event) => setSendInviteEmail(event.target.checked)}
                        />
                        <span>Email each invite link now</span>
                      </label>
                      <div className="migrate-actions">
                        <button
                          type="button"
                          className="app-button"
                          disabled={busy || !checkedEmails.length}
                          onClick={() =>
                            void post({
                              action: "commit-invites",
                              emails: checkedEmails,
                              role: inviteRole,
                              sendEmail: sendInviteEmail,
                            })
                          }
                        >
                          Create {checkedEmails.length} invite{checkedEmails.length === 1 ? "" : "s"}
                        </button>
                      </div>
                    </div>
                  ) : null}
                  {result?.invites ? (
                    <div className="migrate-report">
                      <p className="migrate-preview">
                        {result.invites.invited} invite{result.invites.invited === 1 ? "" : "s"} created
                        {result.invites.emailsSent ? ` · ${result.invites.emailsSent} emailed` : ""}
                      </p>
                      {result.invites.failed.length ? (
                        <ReviewNotes
                          skipped={result.invites.failed.map((item) => ({
                            ref: item.email,
                            reason: item.reason,
                          }))}
                        />
                      ) : null}
                    </div>
                  ) : null}
                  <p>
                    <a href={withOrgHref("/team/members", view.orgId)}>Open Members</a>
                  </p>
                </>
              ) : null}

              {connector === "notion" ? (
                <>
                  {view.notionReady ? (
                    <p>Notion OAuth is configured. You can still paste database JSON below to dual-run.</p>
                  ) : (
                    <EmptyState
                      title="Notion OAuth is not configured"
                      description="Set NOTION_CLIENT_ID to enable OAuth. Paste exported database JSON to preview and commit pages without inventing titles."
                    />
                  )}
                  <FormRow label="Paste Notion database JSON">
                    <textarea value={notionPaste} onChange={(event) => setNotionPaste(event.target.value)} rows={8} />
                  </FormRow>
                  <div className="migrate-actions">
                    <button
                      type="button"
                      className="app-button"
                      disabled={busy || !notionPaste.trim()}
                      onClick={() => void post({ action: "commit-notion", content: notionPaste })}
                    >
                      Import calendar / knowledge / tasks
                    </button>
                    <button
                      type="button"
                      className="app-button secondary"
                      disabled={busy || !notionPaste.trim()}
                      onClick={() => void post({ action: "preview-notion", content: notionPaste })}
                    >
                      Preview
                    </button>
                  </div>
                  <p>
                    <a href={withOrgHref("/team/knowledge", view.orgId)}>Open Knowledge</a>
                    {" · "}
                    <a href={withOrgHref("/tasks", view.orgId)}>Open Tasks</a>
                  </p>
                </>
              ) : null}

              {result?.report ? (
                <ScoutReportView report={result.report as ScoutReport} />
              ) : (
                <ReviewNotes skipped={result?.skipped} errors={result?.errors} />
              )}
              {preview && !result?.report ? <p className="migrate-preview">{preview}</p> : null}
            </Panel>
          )}
        </>
      ) : null}
    </main>
  );
}
