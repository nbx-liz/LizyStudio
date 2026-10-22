# Jobs written by lizyml 0.15 (P-0116 D4)

Real job directories a LizyStudio server on lizyml 0.15.0 wrote during the
P-0116 Phase 1 measurement. `tests/integration/test_p0116_legacy_015_jobs.py`
copies them into a temporary jobs directory and checks what lizyml 0.20 can
and cannot do with them (P-0116 D4, child 7).

## Jobs

| Directory | Kind | What lizyml 0.20 refuses |
|---|---|---|
| `jobs/job_1802e487/` | completed Fit | SHAP (`MODEL_NOT_FIT`, `context.missing == "pipeline_state_per_fold"`) |
| `jobs/job_92ea6d27/` | completed Tune | SHAP, and export-code (`CONFIG_INVALID`: `model.params` holds `num_leaves_ratio`, `min_data_in_leaf_ratio`, `min_data_in_bin_ratio`, `early_stopping.rounds`, `validation_ratio`) |
| `jobs/job_a157e1ae/` | paused Tune | unpause (its Optuna study has no lizyml record: `read_study_lineage` state `legacy`) |

The job ids are part of the fixture: the Optuna study name is derived from
the job id (`studio-tune-<job_id>`).

## Capture metadata

- **Captured**: 2026-10-20, by the Phase 1 server (`.lizystudio/lizyml020-phase1/`)
- **lizyml**: 0.15.0, **LightGBM**: 4.6.0, **Optuna**: 4.7.0
- **Data**: titanic, 418 rows — byte-identical to
  `tests/fixtures/lizyml/binary_no_cal/data.csv`, which the tests use instead
  of a copy

## What was removed

- `execution.log` of each job (it held local scratchpad paths)
- a stray `.claude/` directory in `job_92ea6d27/`

Nothing else was changed. `meta.json` still holds the capture-time
`model_path` and `data_ref.path`; the tests rewrite `model_path` to the copy
and never write into this directory.

## Re-capture

Do not re-capture: these jobs stand for artifacts lizyml 0.15 wrote, and only
a lizyml 0.15 server can write them. Delete the directory with the test once
LizyStudio stops promising a clear refusal for 0.15 jobs.
