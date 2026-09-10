"use client";
// The "Call Your Shot" card, shared by /gearbox, /power-budget and /shooter-table.
//
// A student-tier member sees the calculator's computed fields as prediction inputs.
// Submit locks the guess, the calculator's EXISTING pure functions supply the truth,
// and the reveal shows predicted vs actual with a deterministic explanation of which
// term carried the miss. Mentors are never gated. "Just show me" is always visible
// and is recorded as a skip — never a block.
//
// Lives in lib/learning rather than a route folder because all three surfaces render
// the identical card; it is a client component and imports only pure siblings.

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import styles from "./call-your-shot.module.css";
import {
  resolveLearningModeEnabled,
  shouldGateResult,
  type LearningSurface,
} from "./learning-mode";
import {
  EMPTY_MODE_PREFS,
  readDeviceMode,
  resolveStoredMode,
  shouldMigrateDeviceMode,
  writeDeviceMode,
  type ModePrefs,
} from "./mode-store";
import {
  detectMisconception,
  explainDelta,
  scoreCallYourShot,
  summarizeAccuracyTrend,
  type AccuracyTrend,
  type CallScore,
  type Closeness,
  type DeltaExplanation,
  type MisconceptionCandidate,
} from "./predictions";
import type { CallField, CallFieldSet } from "./surfaces";

const CLOSENESS_RANK: Record<Closeness, number> = { "spot-on": 0, close: 1, off: 2 };

type FieldResult = {
  field: CallField;
  predicted: number;
  score: CallScore;
  explanation: DeltaExplanation;
  misconception: MisconceptionCandidate | null;
};

type Committed = { results: FieldResult[]; closeness: Closeness };

export type CallYourShotProps = {
  surface: LearningSurface;
  /** Resolved org id from the page's own view; null means nothing is recorded. */
  orgId: string | null;
  role: string;
  fieldSet: CallFieldSet;
  /** Input snapshot stored alongside the call. */
  inputs: Record<string, unknown>;
  /** One-line plain summary of those inputs, for the reveal and the coach prompt. */
  inputSummary: string;
  /** Changing this resets the card — a new set of inputs is a new shot to call. */
  signature: string;
  /** The real computed result. Rendered only once the gate is open. */
  children: ReactNode;
};

const EMPTY_TREND: AccuracyTrend = summarizeAccuracyTrend([]);

export function CallYourShot(props: CallYourShotProps) {
  const { surface, orgId, role, fieldSet, inputs, inputSummary, signature, children } = props;

  // Device layer (offline/optimistic) + the server-persisted preference rows.
  // The effective choice is resolved through mode-store's documented precedence:
  // explicit per-surface pref > member default > device value > role default.
  const [deviceStored, setDeviceStored] = useState<boolean | null>(null);
  const [prefs, setPrefs] = useState<ModePrefs>(EMPTY_MODE_PREFS);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [committed, setCommitted] = useState<Committed | null>(null);
  const [skipped, setSkipped] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [statusIsError, setStatusIsError] = useState(false);
  const [trend, setTrend] = useState<AccuracyTrend>(EMPTY_TREND);
  const [trendLoaded, setTrendLoaded] = useState(false);
  const [coach, setCoach] = useState<{ text: string | null; note: string | null; loading: boolean }>({
    text: null,
    note: null,
    loading: false,
  });

  useEffect(() => {
    setDeviceStored(readDeviceMode(surface));
  }, [surface]);

  // Load the persisted preference so the choice follows the member across
  // devices; migrate the pre-phase-2 device-only value up exactly once. A
  // failed fetch leaves the device value in charge — never a broken calculator.
  useEffect(() => {
    if (!orgId) return;
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch(`/api/learning/mode?orgId=${encodeURIComponent(orgId)}`);
        const data = (await response.json()) as {
          status?: string;
          memberDefault?: boolean | null;
          surfaces?: Partial<Record<LearningSurface, boolean>>;
        };
        if (!response.ok || data.status !== "ready") return;
        const server: ModePrefs = {
          memberDefault: typeof data.memberDefault === "boolean" ? data.memberDefault : null,
          surfaces: data.surfaces ?? {},
        };
        if (!cancelled) setPrefs(server);
        const device = readDeviceMode(surface);
        if (
          shouldMigrateDeviceMode({
            surfacePref: server.surfaces[surface] ?? null,
            memberDefault: server.memberDefault,
            deviceStored: device,
          })
        ) {
          // The legacy key was global, so it lands as the member DEFAULT —
          // the migrated meaning matches the old one. Fire-and-forget.
          await fetch("/api/learning/mode", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ orgId, surface: null, enabled: device }),
          }).catch(() => {});
        }
      } catch {
        /* offline — the device value keeps the toggle working. */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [orgId, surface]);

  const storedMode = resolveStoredMode({
    surfacePref: prefs.surfaces[surface] ?? null,
    memberDefault: prefs.memberDefault,
    deviceStored,
  });

  // A new set of inputs is a new shot: nothing carries over from the last call.
  useEffect(() => {
    setDrafts({});
    setCommitted(null);
    setSkipped(false);
    setStatus("");
    setStatusIsError(false);
    setCoach({ text: null, note: null, loading: false });
  }, [signature]);

  const learningModeEnabled = resolveLearningModeEnabled(role, storedMode);
  const gate = shouldGateResult({
    role,
    learningModeEnabled: storedMode,
    alreadyAnswered: committed != null || skipped,
  });
  const fields = fieldSet.status === "ready" ? fieldSet.fields : [];
  const active = gate.gated && fieldSet.status === "ready" && fields.length > 0;

  const loadTrend = useCallback(async () => {
    if (!orgId) return;
    try {
      const response = await fetch(
        `/api/learning/predictions?surface=${encodeURIComponent(surface)}&orgId=${encodeURIComponent(orgId)}`,
      );
      const data = (await response.json()) as { trend?: AccuracyTrend };
      if (response.ok && data.trend) setTrend(data.trend);
    } catch {
      /* The trend is a nicety; a failed fetch must not break the calculator. */
    } finally {
      setTrendLoaded(true);
    }
  }, [orgId, surface]);

  useEffect(() => {
    if (!learningModeEnabled) return;
    void loadTrend();
  }, [learningModeEnabled, loadTrend]);

  const recordCall = useCallback(
    async (payload: { predicted: Record<string, number>; actual: Record<string, number>; closeness: Closeness | null; skipped: boolean }) => {
      if (!orgId) return;
      try {
        const response = await fetch("/api/learning/predictions", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ orgId, surface, inputs, ...payload }),
        });
        const data = (await response.json()) as { trend?: AccuracyTrend; error?: string };
        if (!response.ok) {
          setStatus(data.error ?? "Your call was revealed but could not be saved.");
          setStatusIsError(true);
          return;
        }
        if (data.trend) setTrend(data.trend);
      } catch {
        setStatus("Your call was revealed but could not be saved — you are offline.");
        setStatusIsError(true);
      }
    },
    [inputs, orgId, surface],
  );

  const actualMap = useMemo(() => {
    const map: Record<string, number> = {};
    for (const field of fields) map[field.key] = field.actual;
    return map;
  }, [fields]);

  async function submitCall() {
    const predicted: Record<string, number> = {};
    for (const field of fields) {
      const raw = (drafts[field.key] ?? "").trim();
      const parsed = Number(raw);
      if (!raw || !Number.isFinite(parsed)) {
        setStatus(`Call ${field.label.toLowerCase()} before you lock it in — a guess you will not write down is not a prediction.`);
        setStatusIsError(true);
        return;
      }
      predicted[field.key] = parsed;
    }

    const results: FieldResult[] = fields.map((field) => {
      const value = predicted[field.key]!;
      const score = scoreCallYourShot({
        predicted: value,
        actual: field.actual,
        tolerance: field.tolerance,
        unit: field.unit,
      });
      const explanation = explainDelta(
        { ...inputs, label: field.clause, unit: field.unit },
        value,
        field.actual,
        field.terms(predicted),
      );
      return {
        field,
        predicted: value,
        score,
        explanation,
        misconception: detectMisconception(field.misconceptions, value, field.actual),
      };
    });

    const closeness = results.reduce<Closeness>(
      (worst, r) => (CLOSENESS_RANK[r.score.closeness] > CLOSENESS_RANK[worst] ? r.score.closeness : worst),
      "spot-on",
    );

    setCommitted({ results, closeness });
    setStatus("");
    setStatusIsError(false);
    setBusy(true);
    await recordCall({ predicted, actual: actualMap, closeness, skipped: false });
    setBusy(false);
  }

  async function skipCall() {
    setSkipped(true);
    setStatus("Skipped — logged so a mentor can come back to it with you.");
    setStatusIsError(false);
    setBusy(true);
    await recordCall({ predicted: {}, actual: actualMap, closeness: null, skipped: true });
    setBusy(false);
  }

  async function askCoach() {
    if (!orgId || !committed) return;
    const worst = [...committed.results].sort(
      (a, b) => CLOSENESS_RANK[b.score.closeness] - CLOSENESS_RANK[a.score.closeness],
    )[0];
    if (!worst) return;
    setCoach({ text: null, note: null, loading: true });
    try {
      const response = await fetch("/api/learning/predictions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "coach",
          orgId,
          surface,
          fieldLabel: worst.field.label,
          unit: worst.field.unit,
          predicted: worst.predicted,
          actual: worst.field.actual,
          closeness: worst.score.closeness,
          deterministic: worst.explanation.sentence,
          misconception: worst.misconception?.explanation ?? null,
          inputSummary,
        }),
      });
      const data = (await response.json()) as { paragraph?: string | null; error?: string; message?: string };
      if (!response.ok) {
        setCoach({ text: null, note: data.message ?? data.error ?? "The AI coach is not configured for this team.", loading: false });
        return;
      }
      setCoach({
        text: data.paragraph ?? null,
        note: data.paragraph ? null : "The coach had nothing to add beyond the math above.",
        loading: false,
      });
    } catch {
      setCoach({ text: null, note: "The AI coach is unreachable right now — the math above still stands.", loading: false });
    }
  }

  function renderToggle() {
    return (
      <label className={styles.toggle}>
        <input
          type="checkbox"
          checked={learningModeEnabled}
          onChange={(event) => {
            const next = event.target.checked;
            // Optimistic on both layers: device first (offline-safe), then the
            // per-surface server row. A failed POST costs nothing — this device
            // still remembers, and the server catches up on the next toggle.
            setDeviceStored(next);
            writeDeviceMode(surface, next);
            setPrefs((prev) => ({ ...prev, surfaces: { ...prev.surfaces, [surface]: next } }));
            if (orgId) {
              void fetch("/api/learning/mode", {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ orgId, surface, enabled: next }),
              }).catch(() => {});
            }
          }}
        />
        Learning mode
      </label>
    );
  }

  function renderTrend() {
    if (!learningModeEnabled) return null;
    const dots = trend.total > 0;
    return (
      <div className={styles.trend}>
        <p className={styles.trendHead}>
          <strong>Your last {Math.max(trend.total, 0) || 5} calls here</strong> —{" "}
          {!orgId
            ? "join a team to keep a record of your calls."
            : !trendLoaded
              ? "loading…"
              : trend.headline}
        </p>
        {dots ? (
          <ul className={styles.trendDots}>
            {Array.from({ length: trend.spotOn }, (_, i) => (
              <li key={`s${i}`} className={`${styles.trendDot} ${styles.dotSpotOn}`}>
                spot on
              </li>
            ))}
            {Array.from({ length: trend.close }, (_, i) => (
              <li key={`c${i}`} className={`${styles.trendDot} ${styles.dotClose}`}>
                close
              </li>
            ))}
            {Array.from({ length: trend.off }, (_, i) => (
              <li key={`o${i}`} className={`${styles.trendDot} ${styles.dotOff}`}>
                off
              </li>
            ))}
            {Array.from({ length: trend.skipped }, (_, i) => (
              <li key={`k${i}`} className={styles.trendDot}>
                skipped
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    );
  }

  // Learning mode is on but this surface cannot form a falsifiable call yet —
  // say why instead of inventing a lesson, and never withhold the real result.
  if (learningModeEnabled && gate.tier === "student" && fieldSet.status === "unavailable") {
    return (
      <div className={styles.card}>
        <div className={styles.headRow}>
          <span className={styles.eyebrow}>Call your shot</span>
          {renderToggle()}
        </div>
        <p className={styles.lede}>{fieldSet.reason}</p>
        {children}
        {renderTrend()}
      </div>
    );
  }

  if (!active) {
    const revealed = committed ?? null;
    return (
      <div className={styles.card}>
        <div className={styles.headRow}>
          <span className={styles.eyebrow}>
            {revealed ? "Your call vs the math" : skipped ? "Result (call skipped)" : "Result"}
          </span>
          {renderToggle()}
        </div>
        {revealed ? (
          <div className={styles.reveal}>
            {revealed.results.map((result) => (
              <div
                key={result.field.key}
                className={`${styles.revealRow} ${
                  result.score.closeness === "spot-on"
                    ? styles.spotOn
                    : result.score.closeness === "close"
                      ? styles.closeCall
                      : styles.offCall
                }`}
              >
                <p className={styles.verdict}>
                  {result.field.label}: {result.score.verdict}
                </p>
                <p className={styles.explain}>{result.explanation.sentence}</p>
                {result.misconception ? (
                  <p className={styles.explain}>{result.misconception.explanation}</p>
                ) : null}
                {result.field.note ? <p className={styles.note}>{result.field.note}</p> : null}
              </div>
            ))}
            {orgId ? (
              <div className={styles.actions}>
                <button type="button" className={styles.ghostButton} onClick={() => void askCoach()} disabled={coach.loading}>
                  {coach.loading ? "Asking the coach…" : "Ask the coach for context"}
                </button>
              </div>
            ) : null}
            {coach.text ? <p className={styles.coach}>{coach.text}</p> : null}
            {coach.note ? <p className={styles.coach}>{coach.note}</p> : null}
          </div>
        ) : null}
        {status ? <p className={`${styles.status} ${statusIsError ? styles.error : ""}`}>{status}</p> : null}
        {children}
        {renderTrend()}
      </div>
    );
  }

  return (
    <div className={styles.card}>
      <div className={styles.headRow}>
        <span className={styles.eyebrow}>Call your shot</span>
        {renderToggle()}
      </div>
      <p className={styles.lede}>
        Call the answer before the calculator shows it. The math grades you — and then tells you which term you
        mis-weighted. {inputSummary ? <em>{inputSummary}</em> : null}
      </p>
      <div className={styles.fieldGrid}>
        {fields.map((field) => (
          <label key={field.key} className={styles.field}>
            <span className={styles.fieldLabel}>
              {field.label}
              {field.unit ? ` (${field.unit.trim()})` : ""}
            </span>
            <p className={styles.fieldHint}>{field.hint}</p>
            <input
              type="number"
              step={field.step}
              inputMode="decimal"
              value={drafts[field.key] ?? ""}
              onChange={(event) => setDrafts({ ...drafts, [field.key]: event.target.value })}
              placeholder="Your call"
              aria-label={`Your prediction for ${field.label}`}
            />
          </label>
        ))}
      </div>
      <div className={styles.actions}>
        <button type="button" className={styles.primaryButton} onClick={() => void submitCall()} disabled={busy}>
          Lock in my call
        </button>
        <button type="button" className={styles.ghostButton} onClick={() => void skipCall()} disabled={busy}>
          {gate.skipLabel}
        </button>
      </div>
      {status ? <p className={`${styles.status} ${statusIsError ? styles.error : ""}`}>{status}</p> : null}
      <p className={styles.status}>
        Skipping is fine and is logged, not blocked — a robot at 11pm beats a lesson.
      </p>
      {renderTrend()}
    </div>
  );
}
