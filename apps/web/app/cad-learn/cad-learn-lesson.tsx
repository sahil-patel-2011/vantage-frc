"use client";

import { useState } from "react";
import type { Lesson } from "../../lib/cad-learn/track";
import type { CadLearnView } from "./cad-learn-model";
import { Grader } from "./cad-learn-grader";

function MethodTabs({ methods }: { methods: NonNullable<Lesson["methods"]> }) {
  const [active, setActive] = useState(0);
  const current = methods[Math.min(active, methods.length - 1)]!;
  return (
    <div className="cl-methods">
      {methods.length > 1 ? (
        <div className="cl-method-tabs" role="tablist">
          {methods.map((method, index) => (
            <button
              key={method.label}
              type="button"
              role="tab"
              aria-selected={index === Math.min(active, methods.length - 1)}
              className={index === Math.min(active, methods.length - 1) ? "cl-method-tab active" : "cl-method-tab"}
              onClick={() => setActive(index)}
            >
              {method.label}
            </button>
          ))}
        </div>
      ) : null}
      <ol className="cl-method-lines">
        {current.lines.map((line, index) => (
          <li key={`${current.label}-${index}`}>{line}</li>
        ))}
      </ol>
      {current.note ? <p className="cl-method-note">{current.note}</p> : null}
    </div>
  );
}

export function LessonBody({
  lesson,
  done,
  onToggle,
  view,
  onChanged,
  registerRef,
}: {
  lesson: Lesson;
  done: boolean;
  onToggle: () => void;
  view: CadLearnView | null;
  onChanged: () => void;
  registerRef: (id: string, element: HTMLElement | null) => void;
}) {
  return (
    <section className="cl-lesson" id={lesson.id} ref={(element) => registerRef(lesson.id, element)}>
      <header className="cl-lesson-head">
        <div>
          <h3>
            <a className="cl-anchor" href={`#${lesson.id}`} aria-label={`Link to ${lesson.title}`}>
              #
            </a>
            {lesson.title}
          </h3>
          <small className="cl-muted">
            about {lesson.minutes} min{lesson.gradable ? " · graded" : ""}
          </small>
        </div>
        <label className="cl-done">
          <input type="checkbox" checked={done} onChange={onToggle} />
          <span>Done</span>
        </label>
      </header>

      <p className="cl-why">
        <strong>When you use it —</strong> {lesson.why}
      </p>

      <ol className="cl-steps">
        {lesson.steps.map((step, index) => (
          <li key={`${lesson.id}-s-${index}`}>{step}</li>
        ))}
      </ol>

      {lesson.methods ? <MethodTabs methods={lesson.methods} /> : null}

      <p className="cl-practice">
        <strong>Build this —</strong> {lesson.practice}
      </p>

      {lesson.tip ? (
        <aside className="cl-callout cl-tip">
          <strong>Worth knowing</strong>
          <p>{lesson.tip}</p>
        </aside>
      ) : null}

      {lesson.warning ? (
        <aside className="cl-callout cl-warn">
          <strong>Careful</strong>
          <p>{lesson.warning}</p>
        </aside>
      ) : null}

      <p className="cl-verify">
        <strong>You know it worked when —</strong> {lesson.verify}
      </p>

      {lesson.links.length > 0 ? (
        <ul className="cl-links">
          {lesson.links.map((link) => (
            <li key={link.href}>
              <a
                href={link.href}
                target="_blank"
                rel="noreferrer noopener"
                className={link.primary ? "cl-link cl-link-primary" : "cl-link"}
              >
                {link.label}
                <span aria-hidden="true"> ↗</span>
              </a>
            </li>
          ))}
        </ul>
      ) : null}

      {lesson.gradable ? <Grader lesson={lesson} view={view} onChanged={onChanged} /> : null}
    </section>
  );
}
