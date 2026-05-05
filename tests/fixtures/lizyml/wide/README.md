# Wide DataFrame fixture (Issue #361 / P-0097)

A 10,000-column × 1,000-row synthetic CSV used by:

- Backend stress tests (`tests/regression/test_reg_0361_wide_preview.py`)
- Frontend e2e wide-DataFrame specs

The CSV itself (~50MB) is **gitignored**; regenerate with:

```bash
uv run python tests/fixtures/lizyml/wide/generate.py
```

Schema:

- `target_class` — binary int (0 / 1)
- `f_00001` .. `f_09999` — 9,999 float32 gaussian features

CI generates the fixture once at job start (see workflow steps that
shell out to `generate.py` before the wide-DataFrame test selector
runs).
