# Frontend test fixtures

Real production artifacts captured from end-to-end LizyStudio API runs, used
by frontend tests in place of hand-written synthetic data.

## Why these exist

Synthetic `{ raw: {...} }` test inputs hid the real `{ raw: {...}, calibrated: {...} }`
shape that production writes when calibration is enabled. PR #344 shipped
that bug to GUI because no test used a real `fit_result.json`. Issue #346
introduced this fixture tree to close the gap.

See `lizyml/README.md` for the canonical capture metadata; the JSON files in
this directory are byte-identical copies of what backend tests consume.

## Layout

- `lizyml/fit_result_<scenario>.json` — captured `fit_result.json` per scenario
- `lizyml/tune_result_tune.json` — additional `tune_result.json` for the tune scenario

## Usage

```ts
import calibratedFit from "@/__fixtures__/lizyml/fit_result_binary_isotonic.json";

it("pivots a real calibrated fit_result.json", () => {
  const result = pivotMetrics(calibratedFit.metrics);
  expect(result.auc).toBeDefined();
});
```

## Source of truth

The backend copy at `tests/fixtures/lizyml/<scenario>/fit_result.json` is
authoritative. When re-capturing, update the backend copies first, then
re-run `python /tmp/scrub_fixtures.py` (or equivalent) to refresh this
mirror.
