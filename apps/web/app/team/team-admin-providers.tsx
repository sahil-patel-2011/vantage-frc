"use client";

import { withOrgHref } from "../../lib/nav/product-nav";
import type { CustomProvider } from "./team-admin-model";

export function TeamAdminProvidersPanel({
  orgId,
  providers,
  onAction,
}: {
  orgId: string;
  providers: CustomProvider[];
  onAction: (id: string, action: "test" | "disable") => void;
}) {
  // AI keys are listed under More settings; this panel is only for leftover endpoints.
  if (!providers.length) return null;
  return (
    <section className="compare-panel" id="custom-providers">
      <h2>Older AI connections</h2>
      <p className="app-muted">
        AI keys now live on <a href={withOrgHref("/team/ai-keys", orgId)}>AI keys</a>. These older connections still work until
        you turn them off.
      </p>
      {providers.length ? (
        <section className="intel-panel">
                    {providers.map((item) => (
            <article className="admin-org" key={item.id}>
              <b>{item.localRelay ? "RELAY" : "API"}</b>
              <div>
                <strong>{item.label}</strong>
                <small>
                  {item.kind} · {item.enabled ? "enabled" : "disabled"}
                  {item.baseUrl ? ` · ${item.baseUrl}` : ""}
                  {item.lastTestedAt ? ` · tested ${new Date(item.lastTestedAt).toLocaleString()}` : " · not tested"}
                </small>
                {item.enabled ? (
                  <div>
                    <button type="button" onClick={() => void onAction(item.id, "test")}>
                      Test
                    </button>
                    <button type="button" onClick={() => void onAction(item.id, "disable")}>
                      Turn off
                    </button>
                  </div>
                ) : null}
              </div>
            </article>
          ))}
        </section>
      ) : null}
    </section>
  );
}
