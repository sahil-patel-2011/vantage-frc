"use client";

import { useState } from "react";
import { cadLearnCheckNote, cadLearnFactorLabel } from "../../lib/cad-learn/cad-learn-related";
import type { Lesson } from "../../lib/cad-learn/track";
import {
  BAND_LABEL,
  formatKg,
  formatPercent,
  type CadLearnView,
  type GradeResponse,
} from "./cad-learn-model";

function GradeNotice({ tone, title, message }: { tone: "setup" | "fail"; title: string; message: string }) {
  return (
    <div className={tone === "setup" ? "cl-notice cl-notice-setup" : "cl-notice cl-notice-fail"} role="status">
      <strong>{title}</strong>
      <p>{message}</p>
      <p className="cl-muted">Nothing was graded, and this is not a mark against you.</p>
    </div>
  );
}

function GradeResult({ response }: { response: Extract<GradeResponse, { status: "graded" }> }) {
  const { grade } = response;
  return (
    <div className={`cl-grade cl-grade-${grade.overall}`}>
      <div className="cl-grade-head">
        <span className={`cl-band cl-band-${grade.overall}`}>{BAND_LABEL[grade.overall]}</span>
        <span className="cl-muted">
          Compared on {grade.material}, against the reference measured{" "}
          {new Date(response.referenceMeasuredAt).toLocaleDateString()}
        </span>
      </div>

      <div className="cl-factors">
        {grade.factors.map((factor) => (
          <div key={factor.id} className={`cl-factor cl-factor-${factor.band}`}>
            <p className="cl-factor-label">{cadLearnFactorLabel(factor.id)}</p>
            <p className="cl-factor-value">{formatPercent(factor.percentDifference)}</p>
            <p className="cl-muted">
              {factor.id === "mass"
                ? `yours ${formatKg(factor.student)} · reference ${formatKg(factor.reference)}`
                : `yours ${factor.student.toExponential(3)} · reference ${factor.reference.toExponential(3)}`}
            </p>
            <p className={`cl-factor-band cl-band-${factor.band}`}>{BAND_LABEL[factor.band]}</p>
          </div>
        ))}
        {grade.inertiaUngradedReason ? (
          <div className="cl-factor cl-factor-unknown">
            <p className="cl-factor-label">{cadLearnFactorLabel("moment_of_inertia")}</p>
            <p className="cl-factor-value">Not measured</p>
            <p className="cl-muted">{cadLearnCheckNote(grade.inertiaUngradedReason)}</p>
          </div>
        ) : null}
      </div>

      {grade.perAxisInertiaPercent ? (
        <p className="cl-axes">
          Each spin direction:{" "}
          {grade.perAxisInertiaPercent.map((value, index) => (
            <span key={index} className="cl-axis">
              {formatPercent(value)}
            </span>
          ))}
        </p>
      ) : null}

      {grade.densityCheck ? (
        <p className={grade.densityCheck.sameMaterial ? "cl-density" : "cl-density cl-density-bad"}>
          Material check: yours {Math.round(grade.densityCheck.studentKgM3)} kg/m³ vs reference{" "}
          {Math.round(grade.densityCheck.referenceKgM3)} kg/m³ ({formatPercent(grade.densityCheck.percentDifference)}) —{" "}
          {grade.densityCheck.sameMaterial ? "same material" : "NOT the same material"}
        </p>
      ) : null}

      <div className="cl-what">
        <strong>What to check</strong>
        <ul>
          {grade.whatToCheck.map((note, index) => (
            <li key={index}>{cadLearnCheckNote(note)}</li>
          ))}
        </ul>
      </div>
    </div>
  );
}

/**
 * Both sides read mass from Onshape. Neither side has a field for typing a number in.
 */
export function Grader({
  lesson,
  view,
  onChanged,
}: {
  lesson: Lesson;
  view: CadLearnView | null;
  onChanged: () => void;
}) {
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [response, setResponse] = useState<GradeResponse | null>(null);

  const [referenceUrl, setReferenceUrl] = useState("");
  const [referenceBusy, setReferenceBusy] = useState(false);
  const [referenceNote, setReferenceNote] = useState<string | null>(null);

  const reference = (view?.references ?? []).find((row) => row.lessonId === lesson.id) ?? null;
  const mine = (view?.submissions ?? []).filter((row) => row.lessonId === lesson.id).slice(0, 5);

  async function grade() {
    if (!url.trim()) return;
    setBusy(true);
    setResponse(null);
    try {
      const result = await fetch("/api/cad-learn/grade", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ lessonId: lesson.id, url }),
      });
      const data = (await result.json()) as GradeResponse & { error?: string };
      if (!result.ok) {
        setResponse({ status: "error", message: data.error ?? "Could not grade that part." });
        return;
      }
      setResponse(data);
      if (data.status === "graded") onChanged();
    } catch {
      setResponse({ status: "error", message: "Could not reach the server. Nothing was graded." });
    } finally {
      setBusy(false);
    }
  }

  async function bindReference() {
    if (!referenceUrl.trim()) return;
    setReferenceBusy(true);
    setReferenceNote(null);
    try {
      const result = await fetch("/api/cad-learn/reference", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ lessonId: lesson.id, url: referenceUrl }),
      });
      const data = (await result.json()) as {
        status?: string;
        message?: string;
        error?: string;
        massKg?: number;
        gradesInertia?: boolean;
      };
      if (!result.ok) {
        setReferenceNote(data.error ?? "Could not set the reference part.");
        return;
      }
      if (data.status === "measured") {
        setReferenceNote(
          `Reference measured: ${formatKg(data.massKg ?? 0)}.${
            data.gradesInertia ? "" : " Onshape returned no spin numbers for it, so this lesson will check mass only."
          }`,
        );
        setReferenceUrl("");
        onChanged();
        return;
      }
      setReferenceNote(data.message ?? "Nothing was measured, so no reference was stored.");
    } catch {
      setReferenceNote("Could not reach the server. No reference was stored.");
    } finally {
      setReferenceBusy(false);
    }
  }

  return (
    <div className="cl-grader">
      <div className="cl-grader-head">
        <strong>Grade this part</strong>
        <span className="cl-chip">Material: cast iron</span>
      </div>
      <p className="cl-muted">
        Vantage reads how heavy your part is, and how hard it is to spin, from Onshape and compares them with your
        team&rsquo;s reference part. Both must be on <strong>cast iron</strong> — those numbers both change with
        density, so on a different material neither tells you anything about your shape.
      </p>

      {reference ? (
        <p className="cl-muted">
          Reference set{reference.measuredByName ? ` by ${reference.measuredByName}` : ""} on{" "}
          {new Date(reference.measuredAt).toLocaleDateString()} · {formatKg(Number(reference.massKg))}
          {reference.principalInertia ? "" : " · mass only (no spin numbers in the reference)"}
        </p>
      ) : (
        <p className="cl-muted">
          No reference part is set for this lesson yet, so nothing can be graded. A lead sets it below.
        </p>
      )}

      <label className="cl-field">
        <span>Your Onshape Part Studio URL</span>
        <input
          type="url"
          value={url}
          onChange={(event) => setUrl(event.target.value)}
          placeholder="https://cad.onshape.com/documents/…/w/…/e/…"
          spellCheck={false}
        />
      </label>
      <button type="button" className="cl-button" disabled={busy || !url.trim()} onClick={() => void grade()}>
        {busy ? "Measuring…" : "Grade my part"}
      </button>

      {response?.status === "graded" ? <GradeResult response={response} /> : null}
      {response?.status === "no_reference" ? (
        <GradeNotice tone="setup" title="No reference part yet" message={response.message} />
      ) : null}
      {response?.status === "not_connected" ? (
        <GradeNotice tone="setup" title="Onshape is not connected" message={response.message} />
      ) : null}
      {response?.status === "cannot_read" ? (
        <GradeNotice tone="fail" title="Could not read how heavy your part is" message={response.message} />
      ) : null}
      {response?.status === "error" ? (
        <GradeNotice tone="fail" title="Could not grade that" message={response.message} />
      ) : null}

      {mine.length > 0 ? (
        <details className="cl-fold">
          <summary>Your attempts ({mine.length})</summary>
          <div className="cl-fold-body">
            <table className="cl-table">
              <thead>
                <tr>
                  <th>When</th>
                  <th>Mass</th>
                  <th>Spin</th>
                  <th>Result</th>
                </tr>
              </thead>
              <tbody>
                {mine.map((row) => (
                  <tr key={row.id}>
                    <td>{new Date(row.gradedAt).toLocaleString()}</td>
                    <td>{formatPercent(Number(row.massPercentDifference))}</td>
                    <td>
                      {row.inertiaPercentDifference === null
                        ? "not measured"
                        : formatPercent(Number(row.inertiaPercentDifference))}
                    </td>
                    <td className={`cl-band cl-band-${row.overallBand}`}>{BAND_LABEL[row.overallBand]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      ) : null}

      {view?.canManage ? (
        <details className="cl-fold">
          <summary>Lead: set the reference part for this lesson</summary>
          <div className="cl-fold-body">
            <p className="cl-muted">
              Paste the Onshape URL of the CORRECT part. Vantage measures it over your own Onshape connection and
              stores what it measured — there is no field for typing a mass in, deliberately. Assign cast iron to
              the reference part before you bind it.
            </p>
            <label className="cl-field">
              <span>Reference Part Studio URL</span>
              <input
                type="url"
                value={referenceUrl}
                onChange={(event) => setReferenceUrl(event.target.value)}
                placeholder="https://cad.onshape.com/documents/…/w/…/e/…"
                spellCheck={false}
              />
            </label>
            <button
              type="button"
              className="cl-button"
              disabled={referenceBusy || !referenceUrl.trim()}
              onClick={() => void bindReference()}
            >
              {referenceBusy ? "Measuring…" : "Measure and set as reference"}
            </button>
            {referenceNote ? <p className="cl-note">{referenceNote}</p> : null}
          </div>
        </details>
      ) : null}
    </div>
  );
}
