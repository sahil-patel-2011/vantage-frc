"use client";

import { useEffect, useState, type ReactNode } from "react";
import {
  loadVenueForecast,
  venueWeatherCopy,
} from "../../../lib/dashboard/venue-weather";
import { LiveCountdown } from "./live-countdown";

function asItems(data: Record<string, unknown>, key = "items"): Array<Record<string, unknown>> {
  const raw = data[key];
  return Array.isArray(raw) ? (raw as Array<Record<string, unknown>>) : [];
}

function money(value: unknown): string | null {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return null;
  const rounded = Math.round(n);
  return `$${rounded.toLocaleString()}`;
}

export function DutiesLive({ data }: { data: Record<string, unknown> }) {
  const items = asItems(data);
  return (
    <div>
      <div className="dash-metric-grid">
        <div>
          <strong>{String(data.open ?? items.length)}</strong>
          <span>need a person</span>
        </div>
      </div>
      {items.length ? (
        <ul className="dash-checklist">
          {items.map((item) => (
            <li key={String(item.id)}>
              <span>{String(item.title)}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

export function BudgetPartsLive({ data }: { data: Record<string, unknown> }) {
  const remaining = money(data.remainingUsd);
  return (
    <div className="dash-metric-grid">
      <div>
        <strong>{remaining ?? "—"}</strong>
        <span>budget left</span>
      </div>
      <div>
        <strong>{String(data.pendingCount ?? 0)}</strong>
        <span>part requests</span>
      </div>
    </div>
  );
}

export function AttendanceLive({ data }: { data: Record<string, unknown> }) {
  const items = asItems(data);
  return (
    <ul className="dash-checklist">
      {items.map((item) => (
        <li key={String(item.id)}>
          <span>{String(item.title)}</span>
          <small className="dash-notif-preview">{String(item.marks)} marked</small>
        </li>
      ))}
    </ul>
  );
}

export function HoursLive({ data, label }: { data: Record<string, unknown>; label: string }) {
  return (
    <div className="dash-metric-grid">
      <div>
        <strong>{String(data.hours ?? "—")}</strong>
        <span>{label}</span>
      </div>
    </div>
  );
}

export function AnnouncementsLive({ data }: { data: Record<string, unknown> }) {
  const items = asItems(data);
  return (
    <ul className="dash-checklist">
      {items.map((item) => (
        <li key={String(item.id)}>
          <span>{String(item.title)}</span>
        </li>
      ))}
    </ul>
  );
}

export function EventCountdownLive({ data }: { data: Record<string, unknown> }) {
  const start = typeof data.startDate === "string" ? `${data.startDate}T12:00:00Z` : null;
  return (
    <div>
      <p>
        <strong>{String(data.name ?? "Next event")}</strong>
      </p>
      {start ? (
        <p className="dash-countdown">
          <span>Starts in</span>
          <strong>
            <LiveCountdown iso={start} />
          </strong>
        </p>
      ) : null}
      {typeof data.city === "string" && data.city ? <p className="app-muted">{data.city}</p> : null}
    </div>
  );
}

export function CalendarTodayLive({ data }: { data: Record<string, unknown> }) {
  const items = asItems(data);
  return (
    <ul className="dash-checklist">
      {items.map((item) => (
        <li key={String(item.id)}>
          <span>{String(item.title)}</span>
          <small className="dash-notif-preview">{String(item.startsAt).slice(0, 10)}</small>
        </li>
      ))}
    </ul>
  );
}

export function CadResourcesLive({ data }: { data: Record<string, unknown> }) {
  const items = asItems(data);
  return (
    <ul className="dash-checklist">
      {items.map((item) => (
        <li key={String(item.id)}>
          <span>{String(item.title)}</span>
          {typeof item.externalUrl === "string" && item.externalUrl ? (
            <small className="dash-notif-preview">Onshape link</small>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

export function CodingResourcesLive({ data }: { data: Record<string, unknown> }) {
  return (
    <div>
      <p>
        <strong>{String(data.repo ?? "Repo")}</strong>
      </p>
      {Number(data.openFindings ?? 0) > 0 ? (
        <p className="app-muted">{String(data.openFindings)} Bugbot findings to review</p>
      ) : (
        <p className="app-muted">No open Bugbot findings</p>
      )}
    </div>
  );
}

export function TeamProfileLive({ data }: { data: Record<string, unknown> }) {
  return (
    <div>
      <p>
        <strong>
          {data.teamNumber ? `${data.teamNumber} ` : ""}
          {String(data.nickname ?? "Your team")}
        </strong>
      </p>
      <p className="app-muted">
        {[data.city, data.rookieYear ? `rookie ${data.rookieYear}` : null].filter(Boolean).join(" · ") || "On record"}
      </p>
    </div>
  );
}

export function AllianceDeskLive({ data }: { data: Record<string, unknown> }) {
  return (
    <div>
      <p>
        <strong>{String(data.name ?? "Alliance desk")}</strong>
      </p>
      <p className="app-muted">{data.status === "live" ? "Live pick board" : "Draft board"}</p>
    </div>
  );
}

export function MatchScheduleLive({ data }: { data: Record<string, unknown> }) {
  const items = asItems(data);
  return (
    <ul className="dash-checklist">
      {items.map((item) => (
        <li key={String(item.matchKey)}>
          <span>
            {String(item.compLevel)} {String(item.matchNumber)}
          </span>
          {typeof item.scheduledTime === "string" ? (
            <small className="dash-notif-preview">
              <LiveCountdown iso={item.scheduledTime} />
            </small>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

export function BatteriesLive({ data }: { data: Record<string, unknown> }) {
  return (
    <div className="dash-metric-grid">
      <div>
        <strong>{String(data.active ?? 0)}</strong>
        <span>ready</span>
      </div>
      <div>
        <strong>{String(data.service ?? 0)}</strong>
        <span>in service</span>
      </div>
    </div>
  );
}

export function AssemblyManualLive({ data }: { data: Record<string, unknown> }) {
  return (
    <div>
      <p>
        <strong>{String(data.assemblyName || "Assembly manual")}</strong>
      </p>
      <p className="app-muted">{String(data.status)}</p>
    </div>
  );
}

export function SponsorFollowupsLive({ data }: { data: Record<string, unknown> }) {
  const items = asItems(data);
  return (
    <ul className="dash-checklist">
      {items.map((item) => (
        <li key={String(item.id)}>
          <span>{String(item.name)}</span>
          <small className="dash-notif-preview">due {String(item.nextFollowUpOn)}</small>
        </li>
      ))}
    </ul>
  );
}

export function EventReadinessLive({ data }: { data: Record<string, unknown> }) {
  return (
    <div className="dash-metric-grid">
      <div>
        <strong>
          {String(data.packed ?? 0)}/{String(data.total ?? 0)}
        </strong>
        <span>packed</span>
      </div>
    </div>
  );
}

export function WeatherVenueLive({ data }: { data: Record<string, unknown> }) {
  const [forecast, setForecast] = useState<{ tempC: number; summary: string } | null>(null);
  const [failed, setFailed] = useState(false);
  const city = typeof data.city === "string" ? data.city : "";
  const isEventDay = data.isEventDay === true;
  const country = typeof data.country === "string" ? data.country : "";

  useEffect(() => {
    if (!city || !isEventDay) return;
    let cancelled = false;
    void (async () => {
      try {
        const next = await loadVenueForecast(city, country || null);
        if (cancelled) return;
        if (!next) {
          setFailed(true);
          return;
        }
        setForecast(next);
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [city, isEventDay, country]);

  const copy = venueWeatherCopy({ isEventDay, forecast, failed });
  let forecastLine: ReactNode;
  switch (copy.kind) {
    case "forecast":
      forecastLine = <p>{copy.text}</p>;
      break;
    case "failed":
    case "loading":
    case "off":
      forecastLine = <p className="app-muted">{copy.text}</p>;
      break;
    default: {
      const _exhaustive: never = copy.kind;
      forecastLine = _exhaustive;
    }
  }

  return (
    <div>
      <p>
        <strong>{city}</strong>
        {typeof data.name === "string" ? <span className="app-muted"> · {data.name}</span> : null}
      </p>
      {forecastLine}
    </div>
  );
}
