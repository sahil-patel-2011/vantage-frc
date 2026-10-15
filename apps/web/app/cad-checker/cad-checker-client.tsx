"use client";

import { useRef, useState, type ChangeEvent } from "react";
import { Badge, Button, EmptyState, PageHeader, PageMain, Skeleton, TextBlockSkeleton } from "../../components/ui";
import { runDrawingChecks, sortForReading, summaryLine, type CheckStatus, type DrawingReport } from "../../lib/cad-checker/checks";
import { INSUNITS_NAMES, acadReleaseName, parseDxf, sniffCadFile } from "../../lib/cad-checker/dxf";
import { OnshapeChecks } from "./onshape-checks";

/** Big enough for any real shop drawing; past this a phone would stall reading it. */
const MAX_BYTES = 50 * 1024 * 1024;

type FileState =
  | { status: "empty" }
  | { status: "reading"; name: string }
  | { status: "dwg"; name: string }
  | { status: "unreadable"; name: string; reason: string }
  | { status: "done"; name: string; report: DrawingReport; facts: string[] };

const BADGE: Record<CheckStatus, { tone: "good" | "setup" | "danger"; label: string }> = {
  pass: { tone: "good", label: "Pass" },
  warn: { tone: "setup", label: "Look at this" },
  fail: { tone: "danger", label: "Fail" },
};

async function checkFile(file: File): Promise<FileState> {
  const name = file.name;
  if (file.size > MAX_BYTES) {
    return { status: "unreadable", name, reason: "This file is over 50 MB, too big to check in the browser. Export only the drawing sheet, then try again." };
  }
  let head: Uint8Array;
  try {
    head = new Uint8Array(await file.slice(0, 64).arrayBuffer());
  } catch {
    return { status: "unreadable", name, reason: "Your browser couldn't open the file. Try choosing it again." };
  }
  const kind = sniffCadFile(name, head);
  if (kind.kind === "dwg") return { status: "dwg", name };
  if (kind.kind === "binary-dxf") {
    return { status: "unreadable", name, reason: "This is a binary DXF, which can't be checked yet. Save it again as an ASCII (text) DXF and check that." };
  }
  if (kind.kind === "other") {
    return { status: "unreadable", name, reason: "This isn't a DXF file. Choose a drawing saved or exported as .dxf." };
  }
  let text: string;
  try {
    text = await file.text();
  } catch {
    return { status: "unreadable", name, reason: "Your browser couldn't read the file. Try choosing it again." };
  }
  const parsed = parseDxf(text);
  if (!parsed.ok) return { status: "unreadable", name, reason: parsed.reason };
  const d = parsed.drawing;
  const units = d.header.insunits != null && d.header.insunits !== 0 ? INSUNITS_NAMES[d.header.insunits] ?? null : null;
  const facts = [
    units ? `in ${units}` : "no units set",
    acadReleaseName(d.header.acadver) ? `saved as ${acadReleaseName(d.header.acadver)}` : "",
    `${d.totalEntities} object${d.totalEntities === 1 ? "" : "s"} on ${d.layers.length} layer${d.layers.length === 1 ? "" : "s"}`,
  ].filter(Boolean);
  return { status: "done", name, report: runDrawingChecks(d), facts };
}

export default function CadCheckerClient({ onshapeConfigured }: { onshapeConfigured: boolean }) {
  const [state, setState] = useState<FileState>({ status: "empty" });
  const input = useRef<HTMLInputElement | null>(null);
  const results = useRef<HTMLHeadingElement | null>(null);

  const choose = () => input.current?.click();

  async function onPick(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    // Cleared so choosing the same file again (after fixing it) runs the checks again.
    event.target.value = "";
    if (!file) return;
    setState({ status: "reading", name: file.name });
    const next = await checkFile(file);
    setState(next);
    // Results replace the button the student just pressed: move focus to them so a keyboard or
    // screen-reader user lands on the summary, not on the top of the page.
    requestAnimationFrame(() => results.current?.focus());
  }

  const chooseLabel = state.status === "empty" ? "Choose a DXF file" : "Check another file";

  return (
    <PageMain className="module-page cad-checker-page">
      <PageHeader
        breadcrumbs={
          <>
            <a href="/build">Build</a> / <a href="/build?tab=cad">CAD</a>
          </>
        }
        title="CAD checker"
        description="Check a drawing before it goes to the shop. Each check says pass or fail, why, and how to fix it."
      />

      <section className="cad-checker-section" aria-labelledby="cad-checker-dxf">
        <div className="cad-checker-section-head">
          <h2 id="cad-checker-dxf">Drawing check (DXF)</h2>
          <p>Your file is read on this device and never uploaded.</p>
        </div>
        <input
          ref={input}
          type="file"
          accept=".dxf,.dwg,image/vnd.dxf,application/dxf"
          hidden
          aria-label="DXF drawing file"
          onChange={(event) => void onPick(event)}
        />

        {state.status === "empty" ? (
          <EmptyState
            title="Choose a DXF file to check"
            description="Export your drawing as DXF from AutoCAD, Onshape or Fusion, then choose it here. Vantage checks units, layers, dimensions, the title block and text size."
          >
            <Button variant="primary" onClick={choose}>
              Choose a DXF file
            </Button>
          </EmptyState>
        ) : null}

        {state.status === "reading" ? (
          <div className="cad-checker-loading" role="status" aria-busy="true">
            <span className="sr-only">Checking {state.name}</span>
            <Skeleton width="45%" height={18} />
            <TextBlockSkeleton lines={4} />
          </div>
        ) : null}

        {state.status === "dwg" ? (
          <EmptyState
            badge="Save as DXF"
            badgeTone="setup"
            title={<span ref={results} tabIndex={-1}>DWG files can&apos;t be checked here yet</span>}
            description={
              <>
                <strong>{state.name}</strong> is a DWG, AutoCAD&apos;s own closed format, which a browser can&apos;t read safely.
                Save a copy as DXF (in AutoCAD: Save As → DXF; in Onshape or Fusion: export the drawing as DXF) and check that.
              </>
            }
          >
            <Button variant="primary" onClick={choose}>
              Choose a DXF file
            </Button>
          </EmptyState>
        ) : null}

        {state.status === "unreadable" ? (
          <EmptyState
            badge="Couldn't read"
            title={<span ref={results} tabIndex={-1}>Couldn&apos;t read this file</span>}
            description={
              <>
                <strong>{state.name}</strong>: {state.reason}
              </>
            }
          >
            <Button variant="primary" onClick={choose}>
              Choose another file
            </Button>
          </EmptyState>
        ) : null}

        {state.status === "done" ? (
          <div className="cad-checker-report">
            <div className="cad-checker-summary">
              <div>
                <h3 ref={results} tabIndex={-1} aria-live="polite">
                  {summaryLine(state.report)}
                </h3>
                <p>
                  <strong>{state.name}</strong> · {state.facts.join(" · ")}
                </p>
              </div>
              <Button variant="secondary" onClick={choose}>
                {chooseLabel}
              </Button>
            </div>
            <ul className="cad-checker-results" aria-label="Check results">
              {sortForReading(state.report.results).map((result) => (
                <li key={result.id} className={`cad-checker-result is-${result.status}`} data-testid="cad-check">
                  <details>
                    <summary data-disclosure>
                      <Badge tone={BADGE[result.status].tone}>{BADGE[result.status].label}</Badge>
                      <span>{result.title}</span>
                    </summary>
                    <div className="cad-checker-result-body">
                      <p>
                        <strong>Why</strong>
                        {result.why}
                      </p>
                      {result.status !== "pass" ? (
                        <p>
                          <strong>How to fix it</strong>
                          {result.fix}
                        </p>
                      ) : null}
                    </div>
                  </details>
                </li>
              ))}
            </ul>
            {state.report.skipped ? (
              <p className="cad-checker-note">
                The other {state.report.skipped} checks need something drawn, so they didn&apos;t run.
              </p>
            ) : null}
          </div>
        ) : null}
      </section>

      <OnshapeChecks configured={onshapeConfigured} />
    </PageMain>
  );
}
