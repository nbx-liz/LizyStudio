# Workspace Form Config-Sync Audit — 2026-04-23

**Status**: ✅ shipped 2026-04-23 — Audit completed; findings rolled into PR #255 and the subsequent post-#271 plan + P-0090〜P-0092 work. **本ドキュメントはアーカイブ**（履歴参照のみ）。最新の関連バックログは [docs/ROADMAP.md](./ROADMAP.md) を参照。

Audit prompted by Issue #249 (follow-up to #248).

## Scope

- `frontend/src/components/workspace/**/*.tsx`
- `frontend/src/components/retune/**/*.tsx`
- Hooks touching `PUT /api/workspace/config`: `useConfigSync.ts`

## Methodology

1. Grepped for `<button>` / `role="button"` that could wrap other interactive
   elements (Checkbox, Switch, Button, role="button" div).
2. Walked every form Section for the four-point checklist from #249:
   - No interactive element nested inside a parent `<button>`.
   - UI state flows to parent config via `onChange`.
   - Parent config is included in the `PUT /api/workspace/config` payload.
   - Backend `api/workspace.py` does not drop the field.
3. Inspected `useConfigSync` for dedup / re-sync behaviour under
   `UiSchema === null` and `UiSchema === undefined`.

## Results

### 🔴 HIGH — bug to fix

> **Update 2026-04-23:** H-1 resolved in #253 / PR bundled with this audit
> update. All six onChange sites (five from the original finding plus
> `CalibrationSection.onChange` found during the fix) now route through
> `handleFieldChange`. Regression tests in `ConfigForm.test.tsx` under
> `Issue #253 configRef (two writes in same tick)`.

#### H-1: `ConfigForm` partial onChange handlers capture stale `config`

File: `frontend/src/components/workspace/ConfigForm.tsx`

Locations using `config` (not `configRef.current`):

- L183-187 — `handleHintChange` numeric/boolean branch: `setNestedValue(config, ["model", "params"], newParams)`
- L398-405 — `FeatureWeightsEditor.onChange`: `setNestedValue(config, ["model", "feature_weights"], weights)`
- L441-448 — `KeyValueEditor.onChange`: `setNestedValue(config, ["model", "params"], newParams)`
- L504-511 — Inner Valid Ratio `NumberInput.onChange`: `setNestedValue(config, ["training", "inner_valid", "ratio"], v ?? 0.2)`
- L537-543 — `MetricsChips.onChange`: `setNestedValue(config, ["evaluation", "metrics"], metrics)`

The pre-existing bug comment (HIGH-5, L60-65) already explains why
`configRef` was introduced: two effects writing in the same render would
otherwise race and one write would clobber the other. That same race is
re-exposed by every handler above — they each call
`setNestedValue(config, …)` on the **captured** `config` prop. When two
handlers fire in the same tick (e.g. auto-select objective effect +
KeyValueEditor onChange, or rapid clicks across sections), the second
write wins and overwrites the first.

**Fix sketch:** route every handler through `handleFieldChange` (which
already reads `configRef.current`) — either by extending
`handleFieldChange` to accept a replacement value at a nested path, or
by adding a sibling helper `updateConfigFrom(path, updater)` that reads
`configRef.current` before merging.

Severity rationale: same failure mode as #248 (silent config-sync loss)
and the issue the `configRef` pattern was introduced for — so the risk
is proven, not theoretical.

### 🟢 LOW — no issues found

The remaining MEDIUM targets from #249 were checked and are clean:

| Target | Finding |
|---|---|
| `CalibrationSection.tsx:57-66` | `<Switch>` is a **sibling** of `<AccordionTrigger>` inside a flex container, not nested. Both fire independently. No regression. |
| `TuneEvaluationSection.tsx:72-89` | The `if (params.direction === autoDirection) return` early-return is correct — when the value is already right, no write is needed; the existing value stays in config. Not a data-loss path. |
| `useConfigSync.ts:82` | `strategyFields ?? null` + `fieldsKeyFragment` dedup key correctly re-fires sync when `UiSchema` resolves from `undefined`/`null` to populated. `JSON.stringify(null) === "null"` is stable. No issue. |

LOW targets from #249:

| Target | Finding |
|---|---|
| `ModelParamsSection.tsx` | Pure render; delegates to parent via `handleHintChange`. No nesting. |
| `RetuneSettingsSection.tsx` | Checkbox + Label are siblings under a flex div. Label uses `htmlFor` linkage. No nesting. |
| `SegmentGroup.tsx` / `ChipGroup.tsx` | Flat button lists; ARIA radio/group roles on parent `<div>`, not `<button>`. No nesting. |
| `CompactToggle.tsx` | Native `<input type="checkbox">` inside a `<label>`. No nesting. |
| `PlotSection.tsx:128-141` | Flat tab `<button>` list; no nesting. |
| `ColumnSettingsSection.tsx` | Already fixed in #248 — row is a `role="button"` div with `stopPropagation` wrappers around inner Checkbox/Button. No nesting. |
| Whole tree grep for `role="button"` | 2 hits — `ConfigDiffBadge.tsx` (Badge wrapped by `PopoverTrigger asChild`) and `ColumnSettingsSection.tsx`. Neither nests a `<button>` inside a `<button>`. |

## Regression Prevention

The primary failure mode is **silent config-sync loss**: the UI looks
correct but the `PUT /api/workspace/config` payload is stale. E2E tests
that click a control and then immediately verify the payload catch this
class of bug.

Recommended E2E scenarios for the follow-up PR (fixing H-1):

1. Click objective dropdown → change value → assert the next
   `PUT /api/workspace/config` request body contains the new objective.
2. Toggle a feature weight → assert `model.feature_weights` reaches the
   payload.
3. Edit Additional Params via `KeyValueEditor` → assert `model.params.<key>`
   is in the payload.
4. Change Inner Valid Ratio → assert `training.inner_valid.ratio` is in
   the payload.
5. Toggle a metric chip → assert `evaluation.metrics` is in the payload.
6. **Concurrency probe:** trigger the `objective/metric` auto-select
   effect (by switching `task`) while simultaneously editing
   `KeyValueEditor`; assert both writes land (i.e. the final payload
   contains both the new objective AND the new key-value).

## Follow-up

- New issue: ConfigForm onChange handlers must use `configRef` (H-1).
- No other workspace/retune Sections need changes.
- Close Issue #249 after the follow-up issue is filed.
