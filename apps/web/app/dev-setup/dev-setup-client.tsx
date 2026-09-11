"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  COMMAND_REFERENCE,
  DEV_SETUP_DONE_KEY,
  DEV_SETUP_OS_KEY,
  OS_LABELS,
  TRACK,
  stepsForOs,
  totalMinutes,
  type Os,
  type Step,
} from "../../lib/dev-setup/track";

const OS_KEY = DEV_SETUP_OS_KEY;
const DONE_KEY = DEV_SETUP_DONE_KEY;

type Resource = {
  id: string;
  stepId: string | null;
  title: string;
  url: string | null;
  body: string;
  kind: string;
  authorName: string;
  mine: boolean;
};

type ResourceView = {
  orgName: string;
  teamNumber: number | null;
  resources: Resource[];
};

/** Guess the platform so a student does not start on the wrong tab. */
function detectOs(): Os {
  if (typeof navigator === "undefined") return "windows";
  const ua = `${navigator.userAgent} ${navigator.platform ?? ""}`.toLowerCase();
  return ua.includes("mac") ? "mac" : "windows";
}

function CommandBlock({ lines }: { lines: string[] }) {
  const [copied, setCopied] = useState(false);
  const text = lines.join("\n");
  return (
    <div className="ds-code">
      <pre>
        <code>{text}</code>
      </pre>
      <button
        type="button"
        className="ds-copy"
        onClick={() => {
          void navigator.clipboard?.writeText(text);
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1600);
        }}
      >
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}

/**
 * Alternative ways to do one step, each its own tab.
 *
 * Only the tabs for the reader's platform are shown, so a Windows student never
 * sees a Homebrew tab they cannot use — the point of tabs here is choice
 * between real options, not a platform switch, which the page already has.
 */
function MethodTabs({ methods, os }: { methods: NonNullable<Step["methods"]>; os: Os }) {
  const mine = methods.filter((m) => !m.os || m.os === os);
  const [active, setActive] = useState(0);
  if (mine.length === 0) return null;
  const current = mine[Math.min(active, mine.length - 1)]!;
  return (
    <div className="ds-methods">
      {mine.length > 1 ? (
        <div className="ds-method-tabs" role="group" aria-label="Ways to do this step">
          {mine.map((m, i) => (
            <button
              key={m.label}
              type="button"
              aria-pressed={i === Math.min(active, mine.length - 1)}
              className={i === Math.min(active, mine.length - 1) ? "ds-method-tab active" : "ds-method-tab"}
              onClick={() => setActive(i)}
            >
              {m.label}
            </button>
          ))}
        </div>
      ) : null}
      <CommandBlock lines={current.lines} />
      {current.note ? <p className="ds-method-note">{current.note}</p> : null}
    </div>
  );
}

/**
 * The team's own material for one step, plus the assistant.
 *
 * These sit INSIDE the step rather than on a separate page on purpose: the
 * moment you need your team's repo URL is the moment you are reading "clone the
 * repo", and the moment you need help is the moment a command failed.
 */
function StepExtras({
  step,
  os,
  resources,
  onAdded,
}: {
  step: Step;
  os: Os;
  resources: Resource[];
  onAdded: () => void;
}) {
  const [asking, setAsking] = useState(false);
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState<string | null>(null);
  const [askError, setAskError] = useState("");
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState("");
  const [url, setUrl] = useState("");
  const [note, setNote] = useState("");

  async function ask() {
    if (!question.trim()) return;
    setAsking(true);
    setAskError("");
    setAnswer(null);
    try {
      const response = await fetch("/api/dev-setup/ask", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ question, stepId: step.id, os }),
      });
      const data = (await response.json()) as { text?: string; error?: string };
      if (!response.ok || !data.text) {
        setAskError(data.error ?? "Could not answer that right now.");
        return;
      }
      setAnswer(data.text);
    } catch {
      setAskError("Could not reach the server.");
    } finally {
      setAsking(false);
    }
  }

  async function addResource() {
    if (!title.trim()) return;
    setAdding(true);
    try {
      const response = await fetch("/api/team-resources", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "add",
          stepId: step.id,
          title,
          url: url.trim() || null,
          body: note,
          kind: url.trim() ? "link" : "note",
        }),
      });
      if (response.ok) {
        setTitle("");
        setUrl("");
        setNote("");
        onAdded();
      }
    } finally {
      setAdding(false);
    }
  }

  return (
    <div className="ds-extras">
      {resources.length > 0 ? (
        <div className="ds-team">
          <strong>From your team</strong>
          <ul>
            {resources.map((r) => (
              <li key={r.id}>
                {r.url ? (
                  <a href={r.url} target="_blank" rel="noreferrer noopener">
                    {r.title}
                  </a>
                ) : (
                  <span>{r.title}</span>
                )}
                {r.body ? <em> — {r.body}</em> : null}
                <small className="ds-muted"> · {r.authorName}</small>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <details className="ds-fold">
        <summary>Add something for your team</summary>
        <div className="ds-fold-body">
          <p className="ds-muted">
            Only your team sees this. Use it for the things that are specific to you — your repo URL, who has the
            roboRIO password, the trick that fixed this step last year.
          </p>
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="What is it?" maxLength={160} />
          <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="Link (optional) — https://..." />
          <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} placeholder="Anything worth saying about it" />
          <button type="button" className="ds-link" disabled={adding || !title.trim()} onClick={() => void addResource()}>
            {adding ? "Saving…" : "Save for my team"}
          </button>
        </div>
      </details>

      <details className="ds-fold">
        <summary>Stuck on this step? Ask</summary>
        <div className="ds-fold-body">
          <p className="ds-muted">
            It already knows which step you are on, that you are on {os === "mac" ? "macOS" : "Windows"}, and what your
            team has written here. Just describe what happened.
          </p>
          <textarea
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            rows={2}
            maxLength={1200}
            placeholder="I ran the command and it said 'brew: command not found'"
          />
          <button type="button" className="ds-link" disabled={asking || !question.trim()} onClick={() => void ask()}>
            {asking ? "Thinking…" : "Ask"}
          </button>
          {askError ? <p className="ds-ask-error" role="alert">{askError}</p> : null}
          {answer ? <div className="ds-answer">{answer}</div> : null}
        </div>
      </details>
    </div>
  );
}

function StepBody({
  step,
  os,
  done,
  onToggle,
  resources,
  onAdded,
}: {
  step: Step;
  os: Os;
  done: boolean;
  onToggle: () => void;
  resources: Resource[];
  onAdded: () => void;
}) {
  // A step can carry commands for this platform, for both, or neither.
  const osCommands = step.commands?.[os];
  const sharedCommands = step.commands?.all;

  return (
    <section className="ds-step" id={step.id}>
      <header className="ds-step-head">
        <div>
          <h3>
            <a className="ds-anchor" href={`#${step.id}`} aria-label={`Link to ${step.title}`}>
              #
            </a>
            {step.title}
          </h3>
          <small className="ds-muted">about {step.minutes} min</small>
        </div>
        <label className="ds-done">
          <input type="checkbox" checked={done} onChange={onToggle} />
          Done
        </label>
      </header>

      {/* "When you reach for this" is deliberately first and visually distinct.
          It is the question a new programmer actually has and the one most
          setup guides never answer. */}
      <p className="ds-why">
        <strong>When you use it —</strong> {step.why}
      </p>

      <ol className="ds-install">
        {step.install.map((line, i) => (
          <li key={`${step.id}-i-${i}`}>{line}</li>
        ))}
      </ol>

      {step.methods ? <MethodTabs methods={step.methods} os={os} /> : null}
      {osCommands ? <CommandBlock lines={osCommands} /> : null}
      {sharedCommands ? <CommandBlock lines={sharedCommands} /> : null}

      {step.tip ? (
        <aside className="ds-callout ds-tip">
          <strong>Worth knowing</strong>
          <p>{step.tip}</p>
        </aside>
      ) : null}

      {step.warning ? (
        <aside className="ds-callout ds-warn">
          <strong>Careful</strong>
          <p>{step.warning}</p>
        </aside>
      ) : null}

      <p className="ds-verify">
        <strong>You know it worked when —</strong> {step.verify}
      </p>

      {step.links.length > 0 ? (
        <ul className="ds-links">
          {step.links.map((link) => (
            <li key={link.href}>
              <a
                href={link.href}
                target="_blank"
                rel="noreferrer noopener"
                className={link.download ? "ds-link ds-link-primary" : "ds-link"}
              >
                {link.label}
                {link.download ? <span aria-hidden="true"> ↗</span> : null}
              </a>
            </li>
          ))}
        </ul>
      ) : null}

      <StepExtras step={step} os={os} resources={resources} onAdded={onAdded} />
    </section>
  );
}

export default function DevSetupClient() {
  const [os, setOs] = useState<Os>("windows");
  const [done, setDone] = useState<Set<string>>(new Set());
  const [ready, setReady] = useState(false);
  const [team, setTeam] = useState<ResourceView | null>(null);

  const loadResources = useCallback(async () => {
    try {
      const response = await fetch("/api/team-resources");
      if (!response.ok) return; // Signed out or no workspace — the guide still works.
      setTeam((await response.json()) as ResourceView);
    } catch {
      /* the guide is useful without team notes; never block on them */
    }
  }, []);

  useEffect(() => {
    void loadResources();
  }, [loadResources]);

  useEffect(() => {
    // Progress lives in this browser. It is a convenience, not a record — the
    // roster view a mentor uses reads from the server instead.
    try {
      const savedOs = localStorage.getItem(OS_KEY);
      setOs(savedOs === "mac" || savedOs === "windows" ? savedOs : detectOs());
      const savedDone = localStorage.getItem(DONE_KEY);
      if (savedDone) setDone(new Set(JSON.parse(savedDone) as string[]));
    } catch {
      setOs(detectOs());
    }
    setReady(true);
  }, []);

  const persist = useCallback((next: Set<string>) => {
    try {
      localStorage.setItem(DONE_KEY, JSON.stringify([...next]));
    } catch {
      /* private browsing — the guide still works, it just will not remember */
    }
  }, []);

  const chooseOs = useCallback((next: Os) => {
    setOs(next);
    try {
      localStorage.setItem(OS_KEY, next);
    } catch {
      /* ignore */
    }
  }, []);

  const stages = useMemo(
    () => TRACK.map((stage) => ({ stage, steps: stepsForOs(stage, os) })).filter((s) => s.steps.length > 0),
    [os],
  );

  const allIds = useMemo(() => stages.flatMap((s) => s.steps.map((step) => step.id)), [stages]);
  const completed = allIds.filter((id) => done.has(id)).length;
  const remainingMinutes = stages
    .flatMap((s) => s.steps)
    .filter((step) => !done.has(step.id))
    .reduce((sum, step) => sum + step.minutes, 0);

  function toggle(id: string) {
    setDone((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      persist(next);
      return next;
    });
  }

  return (
    <main className="module-page ds-page">
      <div className="ds-shell">
        {/* Left rail: the whole track at a glance, so you can jump back to any
            step later. This page is meant to be returned to, not read once. */}
        <nav className="ds-side" aria-label="Setup sections">
          <p className="ds-side-title">Programming onboarding</p>
          <div className="ds-side-group">
            <a href="#commands">Essential commands</a>
          </div>
          {stages.map(({ stage, steps }) => (
            <div key={stage.id} className="ds-side-group">
              <a href={`#${stage.id}`}>{stage.title}</a>
              <ul>
                {steps.map((step) => (
                  <li key={step.id}>
                    <a href={`#${step.id}`} className={done.has(step.id) ? "ds-side-done" : undefined}>
                      {done.has(step.id) ? "✓ " : ""}
                      {step.title}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>

        <div className="ds-main">
          <header className="ds-hero">
            <p className="ds-kicker">Programming subteam</p>
            <h1>Set up your laptop and ship your first change</h1>
            <p className="ds-lead">
              Everything you need to write robot code on this team — what to install, when you actually use each
              tool, how GitHub works, and how to check what an AI wrote before it reaches the robot. Come back to
              any step whenever you need it.
              {team?.orgName ? (
                <>
                  {" "}
                  Notes you add are visible to{" "}
                  <strong>
                    {team.orgName}
                    {team.teamNumber ? ` (team ${team.teamNumber})` : ""}
                  </strong>{" "}
                  only.
                </>
              ) : null}
            </p>

            <div className="ds-os" role="group" aria-label="Choose your platform">
              {(["mac", "windows"] as Os[]).map((option) => (
                <button
                  key={option}
                  type="button"
                  className={os === option ? "ds-os-tab active" : "ds-os-tab"}
                  aria-pressed={os === option}
                  onClick={() => chooseOs(option)}
                >
                  {OS_LABELS[option]}
                </button>
              ))}
            </div>

            {ready ? (
              <p className="ds-progress">
                {completed} of {allIds.length} steps done
                {remainingMinutes > 0 ? ` · about ${Math.round(remainingMinutes / 15) * 15} min left` : " · all done"}
                <span className="ds-muted"> · total track {Math.round(totalMinutes(os) / 60)}h</span>
              </p>
            ) : null}
          </header>

          {stages.map(({ stage, steps }) => (
            <section key={stage.id} className="ds-stage" id={stage.id}>
              <h2>
                <a className="ds-anchor" href={`#${stage.id}`} aria-label={`Link to ${stage.title}`}>
                  #
                </a>
                {stage.title}
              </h2>
              <p className="ds-blurb">{stage.blurb}</p>
              {steps.map((step) => (
                <StepBody
                  key={step.id}
                  step={step}
                  os={os}
                  done={done.has(step.id)}
                  onToggle={() => toggle(step.id)}
                  resources={(team?.resources ?? []).filter((r) => r.stepId === step.id)}
                  onAdded={loadResources}
                />
              ))}
            </section>
          ))}

          <section className="ds-stage" id="commands">
            <h2>
              <a className="ds-anchor" href="#commands" aria-label="Link to Essential commands">
                #
              </a>
              Essential commands
            </h2>
            <p className="ds-blurb">
              The lines worth coming back for. Everything here appears in context above — this is the version you
              scan at 10pm when the build is broken.
            </p>
            {COMMAND_REFERENCE.map((group) => {
              const rows = group.rows.filter((r) => !r.os || r.os === os);
              if (rows.length === 0) return null;
              return (
                <div key={group.group} className="ds-ref">
                  <h3>{group.group}</h3>
                  <table className="ds-ref-table">
                    <tbody>
                      {rows.map((row) => (
                        <tr key={row.command}>
                          <td>
                            <code>{row.command}</code>
                          </td>
                          <td>{row.does}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              );
            })}
          </section>

          <section className="ds-stage">
            <h2>Stuck?</h2>
            <p className="ds-blurb">
              Everyone gets stuck on setup — it is the least interesting part and the most fiddly. Ask in the team
              chat with the exact error text pasted in, not a description of it. Someone has almost always hit the
              same thing.
            </p>
            <ul className="ds-links">
              <li>
                <a className="ds-link" href="/team?tab=messages">
                  Ask in team chat
                </a>
              </li>
              <li>
                <a className="ds-link" href="/docs">
                  How Vantage itself works
                </a>
              </li>
            </ul>
          </section>
        </div>
      </div>
    </main>
  );
}
