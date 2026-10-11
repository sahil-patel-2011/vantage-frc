"use client";

import type { HomeStripItem } from "../../lib/home-workflows";
import { withOrgHref } from "../../lib/nav/product-nav";
import { LiveCountdown } from "./widgets";

/**
 * "This week" for students, "Team logistics" for mentors. Only items with
 * something to say are listed; Home decides whether the strip shows at all.
 */
export function DashboardRoleStrip({
  orgId,
  audience,
  items,
  dim,
}: {
  orgId: string;
  audience: "mentor" | "student" | null;
  items: HomeStripItem[];
  /** Edit mode dims and disables everything outside the board. */
  dim: { inert?: boolean; "data-edit-dim"?: string };
}) {
  return (
    <section
      className="dash-role-strip"
      data-audience={audience ?? "student"}
      aria-label={audience === "mentor" ? "Team logistics" : "This week"}
      {...dim}
    >
      <header className="dash-role-strip-head">
        <span>{audience === "mentor" ? "Team logistics" : "This week"}</span>
        <a href={withOrgHref("/logistics", orgId)}>
          {audience === "mentor" ? "Hotels & travel" : "My hotel & leave times"}
        </a>
      </header>
      <ul>
        {items.filter((item) => item.tone !== "neutral").map((item) => (
          <li key={item.key} data-tone={item.tone}>
            <a href={item.href}>
              <span>{item.label}</span>
              <strong>
                {item.at ? (
                  <>
                    {item.detail}
                    <em className="dash-strip-countdown">
                      {" · "}
                      <LiveCountdown iso={item.at} />
                    </em>
                  </>
                ) : (
                  item.detail
                )}
              </strong>
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}
