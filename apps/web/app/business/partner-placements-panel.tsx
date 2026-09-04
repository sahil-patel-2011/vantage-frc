"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import PartnerPlacement from "../../components/partner-placement";
import { EmptyState } from "../../components/ui";
import { sponsorCrmNextActions } from "../../lib/business/sponsor-crm-next-actions";

type Program = {
  settings: { publicId: string; storefrontEnabled: boolean; paymentUrl: string | null; pitch: string } | null;
  packages: Array<{
    id: string;
    name: string;
    priceUsd: string;
    durationDays: number;
    surfaces: string[];
    benefits: string | null;
    active: boolean;
    sortOrder: number;
  }>;
  sponsors: Array<{ id: string; name: string; status: string }>;
  campaigns: Array<{
    id: string;
    sponsorId: string;
    sponsorName: string;
    packageId: string | null;
    packageName: string | null;
    assetId: string | null;
    assetPublicId: string | null;
    seasonYear: number;
    name: string;
    headline: string | null;
    linkUrl: string | null;
    surfaces: string[];
    startOn: string;
    endOn: string;
    amountUsd: string;
    paymentStatus: string;
    status: string;
  }>;
  assets: Array<{
    id: string;
    sponsorId: string;
    publicId: string;
    filename: string;
    width: number;
    height: number;
    status: string;
    createdAt: string;
  }>;
  submissions: Array<{
    id: string;
    packageId: string | null;
    packageName: string | null;
    companyName: string;
    contactName: string;
    contactEmail: string;
    website: string | null;
    message: string | null;
    logoUrl: string | null;
    status: string;
    createdAt: string;
  }>;
};

const SURFACES = ["business_wall", "dashboard_footer", "pit_footer"] as const;
const surfaceLabel: Record<string, string> = {
  business_wall: "Business portal",
  dashboard_footer: "Dashboard footer",
  pit_footer: "Pit command footer",
};
const today = () => new Date().toISOString().slice(0, 10);
const nextYear = () => new Date(Date.now() + 365 * 86_400_000).toISOString().slice(0, 10);

function SurfaceChecks({ defaults = ["business_wall"] }: { defaults?: string[] }) {
  return (
    <div className="placement-surfaces">
      {SURFACES.map((surface) => (
        <label key={surface}>
          <input type="checkbox" name="surfaces" value={surface} defaultChecked={defaults.includes(surface)} />{" "}
          {surfaceLabel[surface]}
        </label>
      ))}
    </div>
  );
}

function PlacementsNextActions({
  orgId,
  canManage,
  program,
  migrationMissing,
}: {
  orgId: string;
  canManage: boolean;
  program: Program | null;
  migrationMissing?: boolean;
}) {
  const actions = sponsorCrmNextActions({
    orgId,
    surface: "placements",
    canManage,
    sponsorCount: program?.sponsors.length ?? 0,
    packageCount: program?.packages.length ?? 0,
    campaignCount: program?.campaigns.length ?? 0,
    storefrontConfigured: Boolean(program?.settings?.publicId),
    pendingSubmissionCount: program?.submissions.filter((item) => item.status === "pending").length ?? 0,
    migrationMissing,
  });
  if (!actions.length) return null;
  return (
    <section className="app-card soft-panel edc-next-actions biz-next-actions" aria-label="Next actions">
      <header>
        <span className="biz-overline">Next actions</span>
        <h2>Packages, payment, then recognition</h2>
        <p>Package IDs stay org-scoped. Placement totals only reflect packages you configured.</p>
      </header>
      <ol>
        {actions.map((action) => (
          <li key={action.id} className={action.primary ? "primary" : undefined}>
            <div>
              <strong>{action.label}</strong>
              <span>{action.detail}</span>
            </div>
            <a className="app-button secondary" href={action.href}>
              Open
            </a>
          </li>
        ))}
      </ol>
    </section>
  );
}

export function PartnerPlacementsPanel({
  orgId,
  seasonYear,
  canManage,
}: {
  orgId: string;
  seasonYear: number;
  canManage: boolean;
}) {
  const [program, setProgram] = useState<Program | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [migrationMissing, setMigrationMissing] = useState(false);

  const load = useCallback(async () => {
    try {
      setMigrationMissing(false);
      const response = await fetch(`/api/business/placements?orgId=${encodeURIComponent(orgId)}`);
      const data = (await response.json()) as Program | { error?: string };
      if (!response.ok || !("packages" in data)) {
        const message = "error" in data ? data.error : "Could not load partner placements";
        if (typeof message === "string" && /migration/i.test(message)) setMigrationMissing(true);
        throw new Error(message ?? "Could not load partner placements");
      }
      setProgram(data);
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load partner placements");
    }
  }, [orgId]);

  useEffect(() => {
    void load();
  }, [load]);

  const mutate = useCallback(
    async (payload: Record<string, unknown>) => {
      if (!canManage || busy) return;
      setBusy(true);
      setError("");
      setNotice("");
      try {
        const response = await fetch("/api/business/placements", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ orgId, seasonYear, ...payload }),
        });
        const data = (await response.json()) as Program | { error?: string };
        if (!response.ok || !("packages" in data)) {
          throw new Error("error" in data ? data.error : "Could not save");
        }
        setProgram(data);
        setNotice("Partner program saved.");
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "Could not save");
      } finally {
        setBusy(false);
      }
    },
    [busy, canManage, orgId, seasonYear],
  );

  const submit = useCallback(
    (event: FormEvent<HTMLFormElement>, action: string) => {
      event.preventDefault();
      const form = event.currentTarget;
      const fields = new FormData(form);
      const payload: Record<string, unknown> = Object.fromEntries(fields.entries());
      payload.surfaces = fields.getAll("surfaces");
      void mutate({ action, ...payload }).then(() => {
        if (["save-package", "create-campaign"].includes(action)) form.reset();
      });
    },
    [mutate],
  );

  const upload = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (!canManage || busy) return;
      setBusy(true);
      setError("");
      const form = new FormData(event.currentTarget);
      form.set("orgId", orgId);
      try {
        const response = await fetch("/api/business/assets", { method: "POST", body: form });
        const data = (await response.json()) as { error?: string; duplicate?: boolean };
        if (!response.ok) throw new Error(data.error ?? "Artwork upload failed");
        setNotice(data.duplicate ? "That exact artwork is already in the library." : "Artwork uploaded for review.");
        event.currentTarget.reset();
        await load();
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "Artwork upload failed");
      } finally {
        setBusy(false);
      }
    },
    [busy, canManage, load, orgId],
  );

  const pending = useMemo(() => program?.submissions.filter((item) => item.status === "pending") ?? [], [program]);

  if (!program && !error) {
    return (
      <EmptyState
        soft
        title="Opening partner placements…"
        description="Loading packages, artwork, and the public storefront settings."
        aria-busy
      />
    );
  }

  if (!program) {
    return (
      <div className="biz-stack">
        <PlacementsNextActions orgId={orgId} canManage={canManage} program={null} migrationMissing={migrationMissing} />
        <EmptyState
          badge="Setup required"
          badgeTone="setup"
          title="Partner placements unavailable"
          description={error || "Apply the partner storefront migration, then try again."}
        >
          <button className="app-button" type="button" onClick={() => void load()}>
            Try again
          </button>
        </EmptyState>
      </div>
    );
  }

  return (
    <div className="biz-stack placement-stack">
      <PlacementsNextActions orgId={orgId} canManage={canManage} program={program} />

      {error ? (
        <div className="biz-alert danger">
          <strong>Couldn&apos;t complete that.</strong>
          <span>{error}</span>
        </div>
      ) : null}
      {notice ? (
        <div className="biz-alert success">
          <strong>Done.</strong>
          <span>{notice}</span>
        </div>
      ) : null}

      {!canManage ? (
        <section className="app-card soft-panel">
          <h2>Partner placement program</h2>
          <p className="app-muted">
            Only a team owner or admin can publish sponsorship packages, accept payment records, or approve creative.
          </p>
        </section>
      ) : null}

      <section className="app-card soft-panel placement-intro">
        <div>
          <span className="biz-overline">Partner placements</span>
          <h2>Recognition packages and live storefront</h2>
          <p className="app-muted">
            Sell only the placements you choose, accept payment directly to the team, then approve every sponsor and every
            image before it appears anywhere. Package IDs are org-scoped — never pulled from another team.
          </p>
        </div>
        {program.settings?.publicId ? (
          <a className="app-button" href={`/support/${program.settings.publicId}`} target="_blank" rel="noreferrer">
            Open storefront →
          </a>
        ) : null}
      </section>

      {!program.packages.length && canManage ? (
        <EmptyState
          soft
          badge="Get started"
          title="No placement packages yet"
          description="Add a priced package with surfaces below. Totals only reflect packages you configure for this team."
        />
      ) : null}

      {!program.sponsors.length ? (
        <EmptyState
          soft
          badge="Setup"
          badgeTone="setup"
          title="Add sponsors in CRM before attaching packages"
          description="Campaigns bind org sponsors to org packages. Start in Sponsor CRM, then return here."
        >
          <a className="app-button" href={`/business?tab=sponsors&orgId=${encodeURIComponent(orgId)}`}>
            Open Sponsor CRM
          </a>
        </EmptyState>
      ) : null}

      {canManage ? (
        <section className="biz-grid two">
          <article className="app-card">
            <span className="biz-overline">Sponsor storefront</span>
            <h2>One safe page to share.</h2>
            <form className="biz-form-grid" onSubmit={(event) => void submit(event, "save-settings")}>
              <label className="biz-field wide">
                <span>Team partnership pitch</span>
                <textarea
                  name="pitch"
                  rows={4}
                  defaultValue={
                    program.settings?.pitch ??
                    "Support student-led robotics and help our team build, compete, and serve the community."
                  }
                />
              </label>
              <label className="biz-field wide">
                <span>Direct payment link</span>
                <input
                  name="paymentUrl"
                  type="url"
                  placeholder="https://your-team-payment-link"
                  defaultValue={program.settings?.paymentUrl ?? ""}
                />
                <small>Money goes straight to your team. You record it once it arrives.</small>
              </label>
              <label className="placement-switch">
                <input name="storefrontEnabled" type="checkbox" defaultChecked={program.settings?.storefrontEnabled ?? false} />{" "}
                Allow public sponsor inquiries
              </label>
              <button className="app-button" disabled={busy}>
                Save storefront
              </button>
            </form>
            {program.settings?.publicId ? (
              <div className="placement-link">
                <span>
                  Share:{" "}
                  <code>{`${typeof window === "undefined" ? "" : window.location.origin}/support/${program.settings.publicId}`}</code>
                </span>
                <button type="button" onClick={() => void mutate({ action: "rotate-storefront" })}>
                  Rotate link
                </button>
              </div>
            ) : null}
          </article>
          <article className="app-card">
            <span className="biz-overline">Placement packages</span>
            <h2>Make recognition clear, not cluttered.</h2>
            <form className="biz-form-grid" onSubmit={(event) => void submit(event, "save-package")}>
              <label className="biz-field">
                <span>Package name</span>
                <input name="name" required placeholder="Gold partner" />
              </label>
              <label className="biz-field">
                <span>Price (USD)</span>
                <input name="priceUsd" type="number" min="0" step="0.01" required />
              </label>
              <label className="biz-field">
                <span>Days live</span>
                <input name="durationDays" type="number" min="1" max="730" defaultValue="365" required />
              </label>
              <label className="biz-field">
                <span>Order</span>
                <input name="sortOrder" type="number" defaultValue="0" />
              </label>
              <label className="biz-field wide">
                <span>What they receive</span>
                <textarea name="benefits" rows={2} placeholder="Thank-you post, logo placement, season recap…" />
              </label>
              <SurfaceChecks />
              <button className="app-button" disabled={busy}>
                Add package
              </button>
            </form>
            <ul className="placement-package-list">
              {program.packages.map((item) => (
                <li key={item.id}>
                  <strong>{item.name}</strong>
                  <span>
                    ${Number(item.priceUsd).toFixed(0)} · {item.durationDays} days ·{" "}
                    {item.surfaces.map((surface) => surfaceLabel[surface]).join(", ")}
                  </span>
                </li>
              ))}
              {!program.packages.length ? <li className="empty">Add your first sponsorship package.</li> : null}
            </ul>
          </article>
        </section>
      ) : null}

      {canManage ? (
        <section className="biz-grid two">
          <article className="app-card">
            <span className="biz-overline">Creative approval</span>
            <h2>Artwork library</h2>
            <form className="biz-inline-form" onSubmit={(event) => void upload(event)}>
              <select name="sponsorId" required defaultValue="">
                <option value="" disabled>
                  Select sponsor
                </option>
                {program.sponsors.map((sponsor) => (
                  <option key={sponsor.id} value={sponsor.id}>
                    {sponsor.name}
                  </option>
                ))}
              </select>
              <input name="file" type="file" accept="image/png,image/jpeg,image/webp" required />
              <button disabled={busy}>Upload logo</button>
            </form>
            <p className="app-muted">PNG, JPEG, or WebP only. We strip metadata, resize, and re-encode every logo before review.</p>
            <div className="placement-assets">
              {program.assets.map((asset) => (
                <article key={asset.id}>
                  <img
                    src={`/api/business/assets/${asset.id}?orgId=${encodeURIComponent(orgId)}`}
                    alt="Sponsor artwork preview"
                  />
                  <div>
                    <strong>{asset.filename}</strong>
                    <span>
                      {asset.width} × {asset.height} · {asset.status}
                    </span>
                    <div className="placement-actions">
                      {asset.status !== "approved" ? (
                        <button
                          type="button"
                          onClick={() => void mutate({ action: "asset-status", assetId: asset.id, status: "approved" })}
                        >
                          Approve
                        </button>
                      ) : null}
                      {asset.status !== "archived" ? (
                        <button
                          type="button"
                          onClick={() => void mutate({ action: "asset-status", assetId: asset.id, status: "archived" })}
                        >
                          Archive
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => {
                            if (window.confirm("Delete this archived artwork permanently?")) {
                              void mutate({ action: "delete-asset", assetId: asset.id });
                            }
                          }}
                        >
                          Delete
                        </button>
                      )}
                    </div>
                  </div>
                </article>
              ))}
              {!program.assets.length ? (
                <p className="biz-empty-inline">Upload a sponsor logo after their organization is in Sponsor CRM.</p>
              ) : null}
            </div>
          </article>
          <article className="app-card">
            <span className="biz-overline">Create placement</span>
            <h2>Nothing goes live until payment and approval are recorded.</h2>
            <form className="biz-form-grid" onSubmit={(event) => void submit(event, "create-campaign")}>
              <label className="biz-field">
                <span>Sponsor</span>
                <select name="sponsorId" required defaultValue="">
                  <option value="" disabled>
                    Select sponsor
                  </option>
                  {program.sponsors.map((sponsor) => (
                    <option key={sponsor.id} value={sponsor.id}>
                      {sponsor.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="biz-field">
                <span>Package</span>
                <select name="packageId" defaultValue="">
                  <option value="">Custom placement</option>
                  {program.packages
                    .filter((item) => item.active)
                    .map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.name}
                      </option>
                    ))}
                </select>
              </label>
              <label className="biz-field">
                <span>Campaign name</span>
                <input name="name" required placeholder="2026 Gold partnership" />
              </label>
              <label className="biz-field">
                <span>Amount (USD)</span>
                <input name="amountUsd" type="number" min="0" step="0.01" required />
              </label>
              <label className="biz-field">
                <span>Start</span>
                <input name="startOn" type="date" defaultValue={today()} required />
              </label>
              <label className="biz-field">
                <span>End</span>
                <input name="endOn" type="date" defaultValue={nextYear()} required />
              </label>
              <label className="biz-field wide">
                <span>Small thank-you line</span>
                <input name="headline" placeholder="Proudly supporting student innovation" />
              </label>
              <label className="biz-field wide">
                <span>Optional sponsor link</span>
                <input name="linkUrl" type="url" placeholder="https://sponsor.example" />
              </label>
              <SurfaceChecks />
              <button className="app-button" disabled={busy}>
                Create draft placement
              </button>
            </form>
          </article>
        </section>
      ) : null}

      <section className="app-card">
        <header className="biz-card-head">
          <div>
            <span className="biz-overline">Placement command</span>
            <h2>Revenue only becomes recognition after two checks.</h2>
          </div>
          <span className="biz-count">{program.campaigns.length}</span>
        </header>
        <div className="placement-campaigns">
          {program.campaigns.map((campaign) => {
            const eligible = program.assets.filter(
              (asset) => asset.sponsorId === campaign.sponsorId && asset.status === "approved",
            );
            return (
              <article key={campaign.id}>
                <div>
                  <strong>
                    {campaign.sponsorName} — {campaign.name}
                  </strong>
                  <span>
                    {campaign.status} · {campaign.paymentStatus} · ${Number(campaign.amountUsd).toFixed(2)} ·{" "}
                    {campaign.startOn} to {campaign.endOn}
                    {campaign.packageName ? ` · ${campaign.packageName}` : ""}
                  </span>
                </div>
                {canManage ? (
                  <div className="placement-actions">
                    {campaign.paymentStatus === "pending" ? (
                      <>
                        <button type="button" onClick={() => void mutate({ action: "mark-paid", campaignId: campaign.id })}>
                          Record payment
                        </button>
                        <button type="button" onClick={() => void mutate({ action: "waive-payment", campaignId: campaign.id })}>
                          Waive payment
                        </button>
                      </>
                    ) : null}
                    <select
                      value={campaign.assetId ?? ""}
                      onChange={(event) => {
                        if (event.target.value) {
                          void mutate({ action: "attach-asset", campaignId: campaign.id, assetId: event.target.value });
                        }
                      }}
                    >
                      <option value="">Attach approved logo</option>
                      {eligible.map((asset) => (
                        <option key={asset.id} value={asset.id}>
                          {asset.filename}
                        </option>
                      ))}
                    </select>
                    {campaign.status === "draft" ? (
                      <button
                        type="button"
                        onClick={() => void mutate({ action: "campaign-status", campaignId: campaign.id, status: "approved" })}
                      >
                        Approve placement
                      </button>
                    ) : null}
                    {!["complete", "cancelled"].includes(campaign.status) ? (
                      <button
                        type="button"
                        onClick={() => void mutate({ action: "campaign-status", campaignId: campaign.id, status: "cancelled" })}
                      >
                        Cancel
                      </button>
                    ) : null}
                  </div>
                ) : null}
              </article>
            );
          })}
          {!program.campaigns.length ? (
            <p className="biz-empty-inline">
              Build a placement after a sponsor commits. It stays a draft until you record payment and approve it.
            </p>
          ) : null}
        </div>
      </section>

      {canManage ? (
        <section className="app-card">
          <header className="biz-card-head">
            <div>
              <span className="biz-overline">Public inquiry inbox</span>
              <h2>Review before it becomes a relationship record.</h2>
            </div>
            <span className="biz-count">{pending.length}</span>
          </header>
          <div className="placement-submissions">
            {pending.map((item) => (
              <article key={item.id}>
                <div>
                  <strong>{item.companyName}</strong>
                  <span>
                    {item.contactName} · {item.contactEmail}
                    {item.packageName ? ` · ${item.packageName}` : ""}
                  </span>
                  <p>{item.message || "No message provided."}</p>
                  {item.logoUrl ? (
                    <small>External logo reference received privately; it is never displayed in the portal.</small>
                  ) : null}
                </div>
                <div className="placement-actions">
                  <button
                    type="button"
                    onClick={() => void mutate({ action: "review-submission", submissionId: item.id, decision: "approved" })}
                  >
                    Approve & create draft
                  </button>
                  <button
                    type="button"
                    onClick={() => void mutate({ action: "review-submission", submissionId: item.id, decision: "rejected" })}
                  >
                    Decline
                  </button>
                </div>
              </article>
            ))}
            {!pending.length ? <p className="biz-empty-inline">No sponsor inquiries waiting for review.</p> : null}
          </div>
        </section>
      ) : null}

      <PartnerPlacement orgId={orgId} surface="business_wall" title="Partners powering this team" />
    </div>
  );
}
