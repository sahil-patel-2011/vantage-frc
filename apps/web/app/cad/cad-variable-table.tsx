"use client";
import { Button } from "../../components/ui";

import { useMemo, useState } from "react";
import {
  parseListedVariables,
  type ListedOnshapeVariable,
} from "../../lib/cad/list-variables";

export type CadVariableTableProps = {
  variables?: ListedOnshapeVariable[] | unknown;
  variableStudioElementId?: string;
  disabled?: boolean;
  onSet: (payload: { name: string; expression: string; variableStudioElementId?: string }) => void | Promise<unknown>;
};

export function CadVariableTable({
  variables,
  variableStudioElementId = "",
  disabled = false,
  onSet,
}: CadVariableTableProps) {
  const listed = useMemo(() => {
    if (Array.isArray(variables) && variables.every(isListedVariable)) {
      return variables.map((row) => ({
        name: row.name.trim(),
        expression: row.expression,
        type: row.type,
      }));
    }
    return parseListedVariables({ variables, variableStudioElementId }).variables;
  }, [variables, variableStudioElementId]);

  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [busyName, setBusyName] = useState<string | null>(null);
  const [error, setError] = useState("");

  function expressionFor(name: string, fallback: string): string {
    return drafts[name] ?? fallback;
  }

  async function submit(row: ListedOnshapeVariable) {
    const expression = expressionFor(row.name, row.expression).trim();
    setError("");
    setBusyName(row.name);
    try {
      await onSet({
        name: row.name,
        expression,
        ...(variableStudioElementId ? { variableStudioElementId } : {}),
      });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not update this variable");
    } finally {
      setBusyName(null);
    }
  }

  return (
    <details className="cad-operation-studio" open>
      <summary>
        <div>
          <span className="eyebrow">VARIABLES</span>
          <strong>Re-edit Onshape variables</strong>
        </div>
        <span className={`app-badge ${listed.length ? "good" : "setup"}`}>
          {listed.length ? `${listed.length} variable${listed.length === 1 ? "" : "s"}` : "No variables"}
        </span>
      </summary>
      <div className="cad-operation-body">
        <p className="app-muted">
          Name and expression come from the Onshape Variables REST. Writes go to a Variable Studio tab — never
          FeatureScript. Empty stays empty.
        </p>
        {variableStudioElementId ? (
          <p className="app-muted">Variable Studio {variableStudioElementId}</p>
        ) : (
          <p className="app-muted">
            No Variable Studio tab listed on this document. Reads may still come from the bound element; writes
            need a Variable Studio element id.
          </p>
        )}
        {error ? (
          <p className="telemetry-status" role="alert">
            {error}
          </p>
        ) : null}
        <section aria-label="Onshape variables">
          {listed.length ? (
            <ol>
              {listed.map((row) => {
                const busy = busyName === row.name;
                return (
                  <li key={row.name}>
                    <div>
                      <strong>{row.name}</strong>
                      <p className="app-muted">{row.type || "ANY"}</p>
                    </div>
                    <div className="cad-operation-grid">
                      <label>
                        Expression
                        <input
                          type="text"
                          value={expressionFor(row.name, row.expression)}
                          disabled={disabled || busy}
                          onChange={(event) => {
                            setDrafts((current) => ({ ...current, [row.name]: event.target.value }));
                            setError("");
                          }}
                        />
                      </label>
                      <Button variant="primary" type="button" disabled={disabled || busy} onClick={() => void submit(row)}>
                        {busy ? "Updating…" : "Update variable"}
                      </Button>
                    </div>
                  </li>
                );
              })}
            </ol>
          ) : (
            <p className="app-muted">
              No variables yet. Bind a document that already has a Variable Studio — the list stays empty until
              Onshape returns real names.
            </p>
          )}
        </section>
      </div>
    </details>
  );
}

function isListedVariable(value: unknown): value is ListedOnshapeVariable {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  return typeof row.name === "string" && row.name.trim().length > 0;
}
