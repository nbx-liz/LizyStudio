# LizyML production-artifact fixtures

Real `fit_result.json` / `metadata.json` artifacts captured from end-to-end GUI
runs against the LizyStudio API stack. Used by backend integration tests
(see `tests/integration/test_fit_load_round_trip.py` once Phase C lands) and
referenced by the frontend mirror at `frontend/src/__fixtures__/lizyml/`.

## Why these exist

PR #344 and Issue #345 both shipped to GUI because tests used hand-written
synthetic data that did not match what production code paths actually wrote
to disk. Real artifacts captured from the same code path users exercise are
the only data source that tracks shape evolution. See
`feedback_production_artifact_fixtures.md` for rationale and Issue #346 for
the rollout plan.

## Scenarios

| Directory | Task | Notable shape | Source CSV |
|---|---|---|---|
| `binary_no_cal/` | binary, no calibration | `metrics: {raw}` | titanic 418 rows |
| `binary_isotonic/` | binary, isotonic calibration | `metrics: {raw, calibrated}` ← shape that broke PR #344 | titanic 418 rows |
| `regression/` | regression | RMSE/MAE metric set | synthetic 80 rows |
| `tune/` | binary + optuna tuning | adds `tune_result.json` | iris-like 150 rows |

Each directory contains:

- `data.csv` — source CSV used to drive the fit
- `config.json` — config payload extracted from the captured `meta.json`
- `fit_result.json` — captured `fit_result.json` artifact
- `metadata.json` — captured `model/metadata.json` artifact
- `tune_result.json` — only in `tune/`

## Capture metadata

- **Captured**: 2026-05-02
- **lizyml version**: 0.9.1
- **Python version**: 3.11.14
- **Platform**: linux

## Re-capture procedure

Re-capture is required only when:

- `lizyml` minor or major version bumps (artifact shape may change)
- LizyStudio's API/Service layer changes how `fit_result.json` or
  `metadata.json` are written (rare; gated by Change Gate)

The procedure is **manual GUI-driven on purpose**. Scripted re-capture would
bypass the API/Service/Adapter layer that determines what production users
write to disk — exactly the layering this fixture set is meant to lock down.

1. Start servers: `uv run lizystudio --reload` and `cd frontend && pnpm dev`
2. For each scenario, in a fresh tab on `http://localhost:5173/`:
   - Upload the matching `data.csv`
   - Select target column (`Survived` for titanic, `target` for iris/regression)
   - For `binary_isotonic`: enable Calibration → method=isotonic
   - For `regression`: target should auto-detect; verify task radio = regression
   - For `tune`: switch to Tune tab, set Number of trials = 10
   - Click Fit (or Tune)
3. After completion, locate the new `.lizystudio/jobs/job_<id>/` directory
4. Copy the artifacts into the matching scenario dir and scrub absolute paths:

   ```python
   import json, shutil
   from pathlib import Path

   JOB = Path(".lizystudio/jobs/job_<id>")          # update per scenario
   OUT = Path("tests/fixtures/lizyml/<scenario>")    # update per scenario
   CSV = Path(".audit/titanic_418.csv")              # match scenario source

   def scrub(o):
       if isinstance(o, dict):
           return {k: ("/path/to/data.csv" if k in ("path","data_path") and isinstance(v,str) and v.startswith(("/tmp/","/home/"))
                      else "/path/to/output_dir" if k in ("output_dir","model_path","model_dir") and isinstance(v,str) and v.startswith("/")
                      else v.split(" [")[0] if k == "python_version" and isinstance(v,str) and " [" in v
                      else scrub(v)) for k, v in o.items()}
       if isinstance(o, list):
           return [scrub(x) for x in o]
       return o

   shutil.copyfile(CSV, OUT / "data.csv")
   for fname in ("fit_result.json",):
       (OUT / fname).write_text(json.dumps(json.loads((JOB / fname).read_text()), indent=2) + "\n")
   for fname, src in (("metadata.json", JOB / "model/metadata.json"), ("config.json", None)):
       data = json.loads(src.read_text()) if src else json.loads((JOB / "meta.json").read_text())["config"]
       (OUT / fname).write_text(json.dumps(scrub(data), indent=2) + "\n")
   ```

5. For `tune`, also write `tune_result.json` (scrubbed) and copy it to
   `frontend/src/__fixtures__/lizyml/tune_result_tune.json`
6. Mirror each `fit_result.json` to `frontend/src/__fixtures__/lizyml/fit_result_<scenario>.json`
7. Verify no leaks: `grep -rE '/tmp/|/home/' tests/fixtures/lizyml/ frontend/src/__fixtures__/lizyml/`
   (must return nothing)
8. Update the **Captured** date and **lizyml version** above
