/**
 * Scrollable config-editor body — hosts ConfigForm (Fit tab) or TuneTab
 * plus the running / validation error overlays.
 *
 * Extracted from ModelPanel as part of B-3. Pure presentation — all
 * state + change handlers flow in via props.
 */

import { AlertTriangle, Info } from "lucide-react";
import { type ConfigError, isBlockingError } from "@/api/types";
import { ConfigForm } from "./ConfigForm";
import { TuneTab } from "./TuneTab";

export interface ConfigEditorBodyProps {
  activeTab: "fit" | "tune";
  hasData: boolean;
  running: boolean;
  errors: ConfigError[];
  /**
   * Search Space parameter keys that are in Choice (categorical) mode
   * with no choices populated (Issue #266). Surfaced as a banner above
   * the search space when activeTab === "tune".
   */
  emptyChoiceKeys?: string[];
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
  emptyChoiceKeys = [],
  schema,
  config,
  onChange,
  task,
  uiSchema,
  columns,
}: ConfigEditorBodyProps) {
  const visibleErrors = errors.filter((err) => err.path || err.message);
  // Issue #394 / PR-C2: split entries by severity so warnings (advisory)
  // render in a yellow banner separate from blocking errors. Pre-PR-B4
  // backends do not emit ``severity``; ``isBlockingError`` defaults to
  // "error" in that case, so the existing red banner keeps working.
  const blockingErrors = visibleErrors.filter(isBlockingError);
  const warningErrors = visibleErrors.filter((err) => !isBlockingError(err));
  const showEmptyChoiceBanner =
    activeTab === "tune" && emptyChoiceKeys.length > 0;

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
          className="mb-4 flex items-center gap-2 rounded-md border border-info-border bg-info p-3"
          data-testid="running-info-bar"
        >
          <Info className="h-4 w-4 shrink-0 text-info-fg" />
          <p className="text-xs text-info-strong-fg">
            A job is currently running. Configuration is locked until the job
            completes.
          </p>
        </output>
      )}
      {hasData && blockingErrors.length > 0 && (
        <div
          className="mb-4 rounded-md border border-destructive/50 bg-destructive/10 p-3"
          data-testid="config-error-banner"
          role="alert"
        >
          {blockingErrors.map((err, i) => (
            <p key={`err-${i}`} className="text-xs text-destructive">
              {[err.path, err.message].filter(Boolean).join(": ")}
            </p>
          ))}
        </div>
      )}
      {hasData && warningErrors.length > 0 && (
        <div
          className="mb-4 rounded-md border border-warning-border bg-warning p-3"
          data-testid="config-warning-banner"
          role="status"
        >
          <div className="flex items-start gap-2">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning-fg" />
            <div className="flex-1 space-y-2">
              {warningErrors.map((err, i) => (
                <div key={`warn-${i}`} className="text-xs">
                  <p className="font-medium text-warning-fg">
                    {[err.path, err.message].filter(Boolean).join(": ")}
                  </p>
                  {err.suggested_fix && (
                    <p className="mt-0.5 text-warning-fg/80">
                      Suggestion: {err.suggested_fix}
                    </p>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
      {showEmptyChoiceBanner && (
        <div
          className="mb-4 rounded-md border border-destructive/50 bg-destructive/10 p-3"
          data-testid="empty-choice-banner"
          role="alert"
        >
          <p className="text-xs font-medium text-destructive">
            Fix validation errors first
          </p>
          <p className="mt-1 text-xs text-destructive">
            Choice mode with no choices: {emptyChoiceKeys.join(", ")}. Add at
            least one choice to each parameter or switch the row back to Fixed.
          </p>
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
