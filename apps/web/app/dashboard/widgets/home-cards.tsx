"use client";

import { useEffect, useState } from "react";
import { DEV_SETUP_DONE_KEY } from "../../../lib/dev-setup/track";
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

export function MyDayLive({ data }: { data: Record<string, unknown> }) {
  const events = asItems(data, "events");
  const duties = asItems(data, "duties");
  return (
    <div>
      {typeof data.matchLabel === "string" && data.matchLabel ? (
        <p>
          Next: <strong>{data.matchLabel}</strong>
          {typeof data.matchAt === "string" ? (
            <>
              {" "}
              in <LiveCountdown iso={data.matchAt} />
            </>
          ) : null}
        </p>
      ) : null}
      {typeof data.bumperCue === "string" && data.bumperCue ? <p className="dash-bumper-cue">{data.bumperCue}</p> : null}
      {events.length ? (
        <ul className="dash-checklist">
          {events.map((event) => (
            <li key={String(event.startsAt) + String(event.title)}>
              <span>{String(event.title)}</span>
              <small className="dash-notif-preview">{String(event.startsAt).slice(11, 16)} UTC</small>
            </li>
          ))}
        </ul>
      ) : null}
      {duties.length ? (
        <ul className="dash-checklist">
          {duties.map((duty) => (
            <li key={String(duty.startsAt) + String(duty.title)}>
              <span>On duty: {String(duty.title)}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

export function LearnProgressLive({ data }: { data: Record<string, unknown> }) {
  const [codeDone, setCodeDone] = useState(0);
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(DEV_SETUP_DONE_KEY);
      const parsed = raw ? (JSON.parse(raw) as unknown) : [];
      setCodeDone(Array.isArray(parsed) ? parsed.length : 0);
    } catch {
      setCodeDone(0);
    }
  }, []);
  const cadCompleted = Number(data.cadCompleted ?? 0);
  const cadTotal = Number(data.cadTotal ?? 0);
  return (
    <div className="dash-metric-grid">
      <div>
        <strong>
          {cadCompleted}
          {cadTotal > 0 ? `/${cadTotal}` : ""}
        </strong>
        <span>CAD lessons done</span>
      </div>
      <div>
        <strong>{codeDone || "—"}</strong>
        <span>laptop setup ticks</span>
      </div>
    </div>
  );
}

export function FilesRecentLive({ data }: { data: Record<string, unknown> }) {
  const items = asItems(data);
  return (
    <ul className="dash-checklist">
      {items.map((file) => (
        <li key={String(file.id)}>
          <span>{String(file.name)}</span>
        </li>
      ))}
    </ul>
  );
}

export function TeamChatLive({ data }: { data: Record<string, unknown> }) {
  const unread = Number(data.unread ?? 0);
  const channels = asItems(data, "channels");
  return (
    <div>
      <div className="dash-metric-grid">
        <div>
          <strong>{unread}</strong>
          <span>unread</span>
        </div>
      </div>
      {channels.length ? (
        <ul className="dash-checklist">
          {channels.map((channel) => (
            <li key={String(channel.title)}>
              <span>{String(channel.title)}</span>
              <small className="dash-notif-preview">{String(channel.unread)} unread</small>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
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

const WMO: Record<number, string> = {
  0: "Clear",
  1: "Mostly clear",
  2: "Partly cloudy",
  3: "Overcast",
  45: "Fog",
  51: "Drizzle",
  61: "Rain",
  71: "Snow",
  80: "Showers",
  95: "Thunderstorm",
};

export function WeatherVenueLive({ data }: { data: Record<string, unknown> }) {
  const [forecast, setForecast] = useState<{ tempC: number; summary: string } | null>(null);
  const [failed, setFailed] = useState(false);
  const city = typeof data.city === "string" ? data.city : "";
  const isEventDay = data.isEventDay === true;

  useEffect(() => {
    if (!city || !isEventDay) return;
    let cancelled = false;
    void (async () => {
      try {
        const geoUrl = new URL("https://geocoding-api.open-meteo.com/v1/search");
        geoUrl.searchParams.set("name", city);
        geoUrl.searchParams.set("count", "1");
        if (typeof data.country === "string" && data.country) geoUrl.searchParams.set("country", data.country);
        const geo = (await (await fetch(geoUrl)).json()) as {
          results?: Array<{ latitude: number; longitude: number }>;
        };
        const place = geo.results?.[0];
        if (!place || cancelled) return;
        const wxUrl = new URL("https://api.open-meteo.com/v1/forecast");
        wxUrl.searchParams.set("latitude", String(place.latitude));
        wxUrl.searchParams.set("longitude", String(place.longitude));
        wxUrl.searchParams.set("current", "temperature_2m,weather_code");
        const wx = (await (await fetch(wxUrl)).json()) as {
          current?: { temperature_2m?: number; weather_code?: number };
        };
        const temp = wx.current?.temperature_2m;
        const code = wx.current?.weather_code;
        if (typeof temp !== "number" || cancelled) return;
        setForecast({
          tempC: Math.round(temp),
          summary: (typeof code === "number" && WMO[code]) || "Weather",
        });
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [city, isEventDay, data.country]);

  return (
    <div>
      <p>
        <strong>{city}</strong>
        {typeof data.name === "string" ? <span className="app-muted"> · {data.name}</span> : null}
      </p>
      {isEventDay && forecast ? (
        <p>
          {forecast.tempC}°C · {forecast.summary}
        </p>
      ) : isEventDay && failed ? (
        <p className="app-muted">Forecast did not load. Check the venue city on the event.</p>
      ) : isEventDay ? (
        <p className="app-muted">Loading the public forecast…</p>
      ) : (
        <p className="app-muted">Forecast shows on event day.</p>
      )}
    </div>
  );
}
