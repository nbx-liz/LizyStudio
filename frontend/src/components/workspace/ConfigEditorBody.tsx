/**
 * Scrollable config-editor body — hosts ConfigForm (Fit tab) or TuneTab
 * plus the running / validation error overlays.
 *
 * Extracted from ModelPanel as part of B-3. Pure presentation — all
 * state + change handlers flow in via props.
 */

import { Info } from "lucide-react";
import type { ConfigError } from "@/api/types";
import { ConfigForm } from "./ConfigForm";
import { TuneTab } from "./TuneTab";

export interface ConfigEditorBodyProps {
  activeTab: "fit" | "tune";
  hasData: boolean;
  running: boolean;
  errors: ConfigError[];
  // biome-ignore lint/suspicious/noExplicitAny: JSON schema shape passes straight through to ConfigForm
  schema: any | undefined;
  config: Record<string, unknown> | undefined;
  onChange: (newConfig: Record<string, unknown>) => Promise<void> | void;
  task: string | null;
  // biome-ignore lint/suspicious/noExplicitAny: UI schema shape passes straight through
  uiSchema: any | undefined;
  columns: string[];
}

export function ConfigEditorBody({
  activeTab,
  hasData,
  running,
  errors,
  schema,
  config,
  onChange,
  task,
  uiSchema,
  columns,
}: ConfigEditorBodyProps) {
  const visibleErrors = errors.filter((err) => err.path || err.message);

  return (
    // tabIndex=0 satisfies axe scrollable-region-focusable (WCAG 2.1.1)
    // on narrow viewports where the panel has no focusable descendant
    // (#167). Biome's a11y/noNoninteractiveTabindex rule conflicts with
    // WCAG here and is overridden in biome.json for this file.
    <div
      tabIndex={0}
      className="flex-1 overflow-auto p-4 focus-visible:outline-none"
    >
      {running && (
        <output
          className="mb-4 flex items-center gap-2 rounded-md border border-blue-200 bg-blue-50 p-3 dark:border-blue-800 dark:bg-blue-950"
          data-testid="running-info-bar"
        >
          <Info className="h-4 w-4 shrink-0 text-blue-600 dark:text-blue-400" />
          <p className="text-xs text-blue-800 dark:text-blue-200">
            A job is currently running. Configuration is locked until the job
            completes.
          </p>
        </output>
      )}
      {hasData && visibleErrors.length > 0 && (
        <div className="mb-4 rounded-md border border-destructive/50 bg-destructive/10 p-3">
          {visibleErrors.map((err, i) => (
            <p key={`err-${i}`} className="text-xs text-destructive">
              {[err.path, err.message].filter(Boolean).join(": ")}
            </p>
          ))}
        </div>
      )}

      <div
        className={running ? "pointer-events-none opacity-60" : undefined}
        data-testid="config-form-area"
        aria-disabled={running}
      >
        {activeTab === "fit" ? (
          schema && config ? (
            <ConfigForm
              schema={schema}
              config={config}
              onChange={onChange}
              task={task}
              uiSchema={uiSchema}
              columns={columns}
            />
          ) : (
            <div
              className="flex flex-col items-center justify-center py-12 text-center text-muted-foreground"
              data-testid="config-guidance"
            >
              <p className="text-sm">
                {hasData
                  ? "Loading configuration..."
                  : "Load data in the Data Panel to configure your model."}
              </p>
            </div>
          )
        ) : config ? (
          <TuneTab
            config={config}
            onChange={onChange}
            task={task}
            uiSchema={uiSchema}
            columns={columns}
          />
        ) : (
          <p className="text-sm text-muted-foreground">Loading config...</p>
        )}
      </div>
    </div>
  );
}
