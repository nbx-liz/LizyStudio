# Jobs written by lizyml 0.20 (P-0117 D1)

Real job directories a LizyStudio server on lizyml 0.20.0 wrote during the
P-0117 Phase 1 measurement, through the HTTP API. They are the only test
material that holds artifacts lizyml 0.20 wrote (`format_version` 4): tests
that build a job with the installed lizyml do not.
`tests/integration/test_p0117_legacy_020_jobs.py` copies them into a
temporary jobs directory and checks what lizyml 0.21 can and cannot do with
them (P-0117 D1).

## Jobs

| Directory | Kind | What lizyml 0.21 does with it |
|---|---|---|
| `jobs/job_cc625b97/` | completed Fit | read, metrics, plots, split and SHAP importance, inference with SHAP, export-code and model export all work |
| `jobs/job_e1afdffa/` | completed Tune (3 trials) | the same as the Fit; retune is refused with 400 `PICKLE_INCOMPATIBLE` (the checkpoint's lizyml minor is 0.20), and the job row stays |
| `jobs/job_44a36460/` | paused Tune (30 trials planned) | detail, log and lineage are readable; unpause is P-0117 D3, and its test lives with the D3 change |

The job ids are part of the fixture: the Optuna study name is derived from
the job id (`studio-tune-<job_id>`).

## Capture metadata

- **Captured**: 2026-11-05, by the P-0117 Phase 1 server
- **lizyml**: 0.20.0, **LightGBM**: 4.6.0, **Optuna**: 4.7.0
- **Data**: titanic, 418 rows — byte-identical to
  `tests/fixtures/lizyml/binary_no_cal/data.csv` (checked with `cmp`), which
  the tests use instead of a copy

## What was removed

- `execution.log` of each job (the paused Tune's held local scratchpad
  paths; the other two were empty)

Nothing else was changed.

## Local paths left in the files

- `meta.json` still holds the capture-time `model_path` and `data_ref.path`.
  The tests rewrite `model_path` to the copy and never write into this
  directory.
- `model.pkl` of both Tune jobs holds the capture-time path of the job's
  `optuna.db` inside the pickled checkpoint. It is binary and is not
  rewritten; the tests never load it through that path. The 0.15 jobs in
  `tests/fixtures/lizyml015/` carry the same kind of path.

## Re-capture

Do not re-capture: these jobs stand for artifacts lizyml 0.20 wrote, and only
a lizyml 0.20 server can write them. Delete the directory with the test once
LizyStudio stops promising to open jobs written under 0.20.
