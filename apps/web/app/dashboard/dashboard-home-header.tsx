"use client";

import { useEffect, useState } from "react";
import { orgNameAddsDetail } from "../../components/app-shell-model";
import { Icon } from "../../components/icon";
import { withOrgHref } from "../../lib/nav/product-nav";
import type { Me } from "./dashboard-board-types";

export function DashboardHomeHeader({
  me,
  orgId,
  greetingText,
  editing,
  detail,
  eventName,
}: {
  me: Me;
  orgId: string;
  greetingText: string;
  editing: boolean;
  detail: string;
  eventName: unknown;
}) {
  const [today, setToday] = useState("");
  useEffect(() => {
    setToday(new Date().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" }));
  }, []);
  const dim = editing ? ({ inert: true, "data-edit-dim": "true" } as const) : {};
  return (
    <header className="dash-home-header">
      <div className="dash-home-intro" {...dim}>
        <p className="dash-home-date">{today || "Your workspace"}</p>
        {/* The greeting is what is specific to opening the page; the team number is in the
            top bar on every page, so it is not repeated here. */}
        <h1 className="dash-hero-greeting">{greetingText}</h1>
        {me.teamNumber && orgNameAddsDetail(me.teamNumber, me.orgName) ? <p className="dash-hero-org">{me.orgName}</p> : null}
        {detail ? <p>{detail}</p> : null}
        {/* The event you are at, as its own row you can tap. Absent until an event is set. */}
        {typeof eventName === "string" && eventName.trim() ? (
          <a className="dash-hero-event" data-tour="event" href={withOrgHref("/command", orgId || null)}>
            <Icon name="pin" />
            <span>{eventName}</span>
            <Icon name="chevron" />
          </a>
        ) : null}
      </div>
    </header>
  );
}
