import { deflateSync } from "node:zlib";
import type { PoolClient } from "@neondatabase/serverless";
import { afterEach, describe, expect, it, vi } from "vitest";
import { wheelBeforeScrewsAssembly } from "./fixtures";
import { advanceRun, type RunCheckpoint, type RunContext } from "./run";

/**
 * The stage machine, driven across two slices with a fake database and a fake
 * Onshape.
 *
 * The behaviour under test is the one that decides whether this feature works
 * on a relay that gets unplugged: a run that stops mid-render must resume at
 * the step it reached, must not re-render what it already rendered, and must
 * still finish with a PDF.
 */

// --- a minimal real PNG so the shaded-view reader accepts it ----------------

function crc32(bytes: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const typed = Buffer.concat([Buffer.from(type, "latin1"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typed));
  return Buffer.concat([length, typed, crc]);
}

function tinyPng(): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(2, 0);
  ihdr.writeUInt32BE(2, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const raw = Buffer.from([0, 10, 20, 30, 40, 50, 60, 0, 70, 80, 90, 100, 110, 120]);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const PNG = tinyPng();

// --- fake database ----------------------------------------------------------

type StepRow = {
  step_number: number;
  subassembly: string;
  title: string;
  sentence: string;
  sentence_source: string;
  parts: unknown;
  fabrication: unknown;
  feasibility: { notes?: string[] };
  disagreement: unknown;
  render_png: Buffer | null;
  render_mode: string;
  render_note: string;
};

type FakeDb = {
  client: PoolClient;
  run: {
    checkpoint: RunCheckpoint | null;
    progress: Record<string, unknown>;
    report: unknown;
    pdf: Buffer | null;
    status: string;
  };
  steps: Map<number, StepRow>;
  checkpointWrites: number;
};

function fakeDb(checkpoint: RunCheckpoint | null): FakeDb {
  const state: FakeDb = {
    client: null as unknown as PoolClient,
    run: { checkpoint, progress: {}, report: null, pdf: null, status: "running" },
    steps: new Map(),
    checkpointWrites: 0,
  };

  const query = async (sql: string, values: unknown[] = []) => {
    const text = sql.replace(/\s+/g, " ").trim();

    if (text.startsWith("SELECT checkpoint")) {
      return {
        rows: [
          {
            checkpoint: state.run.checkpoint,
            documentId: "D",
            workspaceId: "W",
            elementId: "ASM",
            assemblyName: "Chassis",
          },
        ],
        rowCount: 1,
      };
    }
    if (text.startsWith("UPDATE assembly_manual_runs SET checkpoint")) {
      state.run.checkpoint = JSON.parse(values[1] as string) as RunCheckpoint;
      state.run.progress = JSON.parse(values[2] as string) as Record<string, unknown>;
      state.checkpointWrites += 1;
      return { rows: [], rowCount: 1 };
    }
    if (text.startsWith("DELETE FROM assembly_manual_steps")) {
      state.steps.clear();
      return { rows: [], rowCount: 0 };
    }
    if (text.startsWith("INSERT INTO assembly_manual_steps")) {
      const stepNumber = values[2] as number;
      state.steps.set(stepNumber, {
        step_number: stepNumber,
        subassembly: values[3] as string,
        title: values[4] as string,
        sentence: values[5] as string,
        sentence_source: "deterministic",
        parts: JSON.parse(values[6] as string),
        fabrication: JSON.parse(values[7] as string),
        feasibility: JSON.parse(values[8] as string),
        disagreement: values[9] ? JSON.parse(values[9] as string) : null,
        render_png: null,
        render_mode: "none",
        render_note: "",
      });
      return { rows: [], rowCount: 1 };
    }
    if (text.startsWith("UPDATE assembly_manual_steps SET render_png")) {
      const row = state.steps.get(values[1] as number);
      if (row) {
        row.render_png = (values[2] as Buffer | null) ?? null;
        row.render_mode = values[3] as string;
        row.render_note = values[4] as string;
      }
      return { rows: [], rowCount: 1 };
    }
    if (text.startsWith("UPDATE assembly_manual_steps SET sentence")) {
      const row = state.steps.get(values[1] as number);
      if (row) {
        row.sentence = values[2] as string;
        row.sentence_source = values[3] as string;
      }
      return { rows: [], rowCount: 1 };
    }
    if (text.startsWith("SELECT step_number")) {
      const rows = [...state.steps.values()]
        .sort((a, b) => a.step_number - b.step_number)
        .map((row) => ({
          stepNumber: row.step_number,
          subassembly: row.subassembly,
          title: row.title,
          sentence: row.sentence,
          parts: row.parts,
          fabrication: row.fabrication,
          feasibility: row.feasibility,
          renderNote: row.render_note,
          png: row.render_png,
        }));
      return { rows, rowCount: rows.length };
    }
    if (text.startsWith("UPDATE assembly_manual_runs SET pdf")) {
      state.run.pdf = values[1] as Buffer;
      state.run.report = JSON.parse(values[3] as string);
      state.run.progress = JSON.parse(values[4] as string);
      state.run.status = "completed";
      state.run.checkpoint = { stage: "done" };
      return { rows: [], rowCount: 1 };
    }
    throw new Error(`Unexpected SQL in the fake database: ${text.slice(0, 90)}`);
  };

  state.client = { query } as unknown as PoolClient;
  return state;
}

// --- fake Onshape -----------------------------------------------------------

/**
 * A clock the test drives, so "the slice ran out of time" is deterministic
 * rather than a race against the machine this happens to run on.
 */
function fakeClock() {
  let now = 1_700_000_000_000;
  vi.spyOn(Date, "now").mockImplementation(() => now);
  return {
    advance(ms: number) {
      now += ms;
    },
  };
}

function fakeShadedViews(paths: string[], clock?: { advance: (ms: number) => void }, costMs = 0) {
  return async (path: string, init?: RequestInit): Promise<Response> => {
    paths.push(`${init?.method ?? "GET"} ${path.split("?")[0]}`);
    clock?.advance(costMs);
    // This deployment does not accept a hidden-occurrence body, which is the
    // realistic case and the one the fallback chain exists for.
    if (init?.method === "POST") return new Response("nope", { status: 400 });
    const body = new ArrayBuffer(PNG.byteLength);
    new Uint8Array(body).set(PNG);
    return new Response(body, { status: 200, headers: { "content-type": "image/png" } });
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

function context(db: FakeDb, http: ReturnType<typeof fakeShadedViews>, budgetMs: number, cancelled = false): RunContext {
  return {
    client: db.client,
    runId: "11111111-1111-4111-8111-111111111111",
    orgId: "22222222-2222-4222-8222-222222222222",
    teamName: "Team 6925",
    http,
    invoke: null,
    deadlineMs: Date.now() + budgetMs,
    isCancelled: async () => cancelled,
    heartbeat: async () => undefined,
  };
}

function checkpointAtGraphStage(): RunCheckpoint {
  return { stage: "graph", facts: wheelBeforeScrewsAssembly() };
}

describe("advanceRun", () => {
  it("plans, renders, writes and produces a PDF in one generous slice", async () => {
    const db = fakeDb(checkpointAtGraphStage());
    const paths: string[] = [];
    const result = await advanceRun(context(db, fakeShadedViews(paths), 120_000));

    expect(result.finished).toBe(true);
    expect(result.stage).toBe("done");
    expect(db.run.status).toBe("completed");
    expect(db.run.pdf!.subarray(0, 8).toString("latin1")).toBe("%PDF-1.4");
    expect(db.steps.size).toBe(4);

    // Every step got a real Onshape render, and the mode is recorded so a
    // reader knows what they are looking at.
    for (const step of db.steps.values()) {
      expect(step.render_png).not.toBeNull();
      expect(step.render_mode).toBe("part");
      expect(step.render_note).toContain("on its own");
    }

    // The hidden-occurrence POST was tried once and then never again.
    expect(paths.filter((path) => path.startsWith("POST"))).toHaveLength(1);
  });

  it("writes a report that admits what it could not settle", async () => {
    const db = fakeDb(checkpointAtGraphStage());
    await advanceRun(context(db, fakeShadedViews([]), 120_000));
    const report = db.run.report as {
      checksRun: number;
      checksPassed: number;
      disagreements: unknown[];
      unresolved: unknown[];
      renderModes: Record<string, number>;
      cutList: unknown[];
      hardware: unknown[];
    };
    expect(report.checksRun).toBeGreaterThan(0);
    expect(report.checksPassed).toBe(report.checksRun);
    expect(report.disagreements.length).toBeGreaterThan(0);
    expect(report.renderModes.part).toBe(4);
    expect(report.hardware).toHaveLength(1);
    expect(report.cutList.length).toBeGreaterThan(0);
  });

  it("resumes at the step it reached, and does not render it twice", async () => {
    // Each Onshape call costs a minute of the slice, so the first slice runs
    // out partway through the renders — exactly the case a relay hits.
    const clock = fakeClock();
    const db = fakeDb(checkpointAtGraphStage());
    const firstPaths: string[] = [];
    const first = await advanceRun(context(db, fakeShadedViews(firstPaths, clock, 60_000), 200_000));

    expect(first.finished).toBe(false);
    expect(first.stage).toBe("render");
    expect(db.run.checkpoint!.stage).toBe("render");
    expect(db.run.checkpoint!.plan).toHaveLength(4);

    const renderedFirst = [...db.steps.values()].filter((step) => step.render_png).length;
    expect(renderedFirst).toBeGreaterThan(0);
    expect(renderedFirst).toBeLessThan(4);
    expect(db.run.checkpoint!.cursor).toBe(renderedFirst);
    // The cover PNG is kept on the checkpoint, so the resume does not re-fetch it.
    expect(db.run.checkpoint!.coverPng).toBeTruthy();

    // Second slice: same checkpoint row, a fresh worker, a generous budget.
    const secondPaths: string[] = [];
    const second = await advanceRun(context(db, fakeShadedViews(secondPaths, clock, 60_000), 10_000_000));

    expect(second.finished).toBe(true);
    expect(db.run.pdf).not.toBeNull();
    expect([...db.steps.values()].every((step) => step.render_png)).toBe(true);

    // Across both slices: one cover render, one refused hidden-occurrence POST,
    // and exactly one part render per step. Nothing was done twice.
    const allPaths = [...firstPaths, ...secondPaths];
    expect(allPaths.filter((path) => path === "GET /assemblies/d/doc/w/ws/e/asm/shadedviews")).toHaveLength(1);
    expect(allPaths.filter((path) => path.startsWith("POST"))).toHaveLength(1);
    expect(allPaths.filter((path) => path.includes("/parts/"))).toHaveLength(4);
  });

  it("stops without writing a PDF when a cancel has been asked for", async () => {
    const db = fakeDb(checkpointAtGraphStage());
    const result = await advanceRun(context(db, fakeShadedViews([]), 120_000, true));
    expect(result.cancelled).toBe(true);
    expect(result.finished).toBe(false);
    expect(db.run.pdf).toBeNull();
  });

  it("checkpoints repeatedly rather than only at the end", async () => {
    const db = fakeDb(checkpointAtGraphStage());
    await advanceRun(context(db, fakeShadedViews([]), 120_000));
    expect(db.checkpointWrites).toBeGreaterThan(3);
  });

  it("keeps the deterministic sentence when no model is available", async () => {
    const db = fakeDb(checkpointAtGraphStage());
    await advanceRun(context(db, fakeShadedViews([]), 120_000));
    for (const step of db.steps.values()) {
      expect(step.sentence_source).toBe("deterministic");
      expect(step.sentence).toMatch(/^Fit /);
    }
    const report = db.run.report as { notes: string[] };
    expect(report.notes.some((note) => /No AI model was available/.test(note))).toBe(true);
  });

  it("refuses to work from a checkpoint with no assembly facts", async () => {
    const db = fakeDb({ stage: "graph" });
    await expect(advanceRun(context(db, fakeShadedViews([]), 60_000))).rejects.toThrow(/no assembly facts/);
  });
});
