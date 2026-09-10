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
  return (
    <section className="compare-panel" id="custom-providers">
      <span className="eyebrow">AI keys</span>
      <p>
        OpenAI, Anthropic, and Ollama / LM Studio live on{" "}
        <a href={withOrgHref("/team/ai-keys", orgId)}>AI keys</a>
        — personal or team-wide.
      </p>
      {providers.length ? (
        <section className="intel-panel">
          <span className="eyebrow">LEFTOVER CUSTOM ENDPOINTS</span>
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
                      Disable
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
