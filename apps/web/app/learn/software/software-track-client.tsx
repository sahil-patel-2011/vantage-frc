"use client";

import { useEffect, useState } from "react";
import { Button, PageHeader } from "../../../components/ui";
import { withOrgHref } from "../../../lib/nav/product-nav";
import {
  SOFTWARE_TRACK_PAGE_DESCRIPTION,
  SOFTWARE_TRACK_STORAGE_KEY,
  SOFTWARE_TRACK_UNITS,
  nextRequiredId,
  requiredDoneCount,
  requiredUnits,
} from "../../../lib/learn/software-track";

function readChecked(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(SOFTWARE_TRACK_STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((id): id is string => typeof id === "string");
  } catch {
    return [];
  }
}

export function SoftwareTrackClient() {
  const [checked, setChecked] = useState<string[]>([]);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setChecked(readChecked());
    setReady(true);
  }, []);

  function toggle(id: string) {
    setChecked((current) => {
      const next = current.includes(id) ? current.filter((item) => item !== id) : [...current, id];
      window.localStorage.setItem(SOFTWARE_TRACK_STORAGE_KEY, JSON.stringify(next));
      return next;
    });
  }

  const requiredTotal = requiredUnits().length;
  const requiredDone = requiredDoneCount(checked);
  const nextId = ready ? nextRequiredId(checked) : null;

  return (
    <main className="module-page software-track-page">
      <PageHeader
        breadcrumbs={
          <>
            <a href={withOrgHref("/build", null)}>Build</a>
            {" / "}
            <a href={withOrgHref("/learn", null)}>Code & CAD</a>
            {" / Software track"}
          </>
        }
        title="Software track"
        description={SOFTWARE_TRACK_PAGE_DESCRIPTION}
      >
        <nav className="product-hub-related" aria-label="Related coding tools">
          <Button as="a" variant="secondary" className="qol-press" href={withOrgHref("/dev-setup", null)}>
            Programming setup
          </Button>
          <Button as="a" variant="secondary" className="qol-press" href={withOrgHref("/code", null)}>
            Code
          </Button>
          <Button as="a" variant="secondary" className="qol-press" href={withOrgHref("/learn/6925", null)}>
            Team 6925 lab
          </Button>
          <Button as="a" variant="secondary" className="qol-press" href={withOrgHref("/tuning-autopilot", null)}>
            Tuning Autopilot
          </Button>
        </nav>
      </PageHeader>

      <p className="software-track-lead">
        Required units run through PID + feedforward. Later units are optional. Ticks stay on this
        phone — nothing is marked done until you check it.
      </p>

      {ready ? (
        <p className="software-track-progress" role="status">
          Required {requiredDone} of {requiredTotal} on this phone
        </p>
      ) : null}

      <ol className="software-track-list">
        {SOFTWARE_TRACK_UNITS.map((unit) => {
          const done = ready && checked.includes(unit.id);
          const next = nextId === unit.id;
          return (
            <li
              key={unit.id}
              className={next ? "software-track-unit is-next" : "software-track-unit"}
              id={`unit-${unit.id}`}
              aria-current={next ? "step" : undefined}
            >
              <label className="software-track-check">
                <input
                  type="checkbox"
                  checked={done}
                  disabled={!ready}
                  onChange={() => toggle(unit.id)}
                />
                <span>
                  {unit.id} · {unit.title}
                  {unit.required ? <em>Required</em> : <em>Optional</em>}
                  {next ? <strong className="software-track-up-next">Up next</strong> : null}
                </span>
              </label>
              <p>{unit.blurb}</p>
              <ul className="software-track-links">
                {unit.hrefs.map((link) => {
                  const internal = link.href.startsWith("/");
                  return (
                    <li key={link.href}>
                      <a
                        href={internal ? withOrgHref(link.href, null) : link.href}
                        target={internal ? undefined : "_blank"}
                        rel={internal ? undefined : "noreferrer noopener"}
                      >
                        {link.label}
                        {internal ? null : <span aria-hidden="true"> ↗</span>}
                      </a>
                    </li>
                  );
                })}
              </ul>
            </li>
          );
        })}
      </ol>
    </main>
  );
}
