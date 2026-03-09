"""Export service — model and report export (H-0005)."""

from __future__ import annotations

from pathlib import Path
from typing import Any

from lizystudio.backends.base import BackendAdapter
from lizystudio.services.jobs import Job


def export_model(
    *,
    job: Job,
    backend: BackendAdapter,
    output_path: str,
) -> str:
    """Export a trained model to the given path.

    Loads the model from the job's saved model_path and re-exports it to
    a user-specified location.
    """
    if job.model_path is None:
        msg = f"Job {job.job_id} has no saved model"
        raise ValueError(msg)

    model: Any = backend.load_model(job.model_path)
    resolved = backend.export_model(model, output_path)
    return resolved


def export_report(
    *,
    job: Job,
    backend: BackendAdapter,
    output_path: str,
) -> str:
    """Export an HTML report with metrics and plots.

    Generates a self-contained HTML file summarizing the job results.
    """
    if job.model_path is None:
        msg = f"Job {job.job_id} has no saved model"
        raise ValueError(msg)

    model: Any = backend.load_model(job.model_path)

    # Collect report data
    metrics = backend.evaluate_table(model)
    info = backend.model_info(model)
    plots = backend.available_plots(model)
    plot_jsons: list[str] = []
    for pt in plots[:5]:  # Limit to first 5 plots
        try:
            pd = backend.plot(model, pt)
            plot_jsons.append(pd.plotly_json)
        except Exception:  # noqa: BLE001
            pass

    # Build HTML
    out = Path(output_path)
    out.parent.mkdir(parents=True, exist_ok=True)
    if out.is_dir() or not out.suffix:
        out = out / f"report_{job.job_id}.html"

    html = _build_report_html(job=job, info=info, metrics=metrics, plot_jsons=plot_jsons)
    out.write_text(html, encoding="utf-8")
    return str(out)


def _build_report_html(
    *,
    job: Job,
    info: dict[str, Any],
    metrics: list[dict[str, Any]],
    plot_jsons: list[str],
) -> str:
    """Build a minimal self-contained HTML report."""
    import html
    import json

    title = html.escape(f"Job {job.job_id} — {job.job_type.title()} Report")
    task = html.escape(str(info.get("task", "")))
    model_name = html.escape(str(info.get("model_name", "")))

    # Metrics table rows
    metric_rows = ""
    if metrics:
        cols = list(metrics[0].keys())
        header = "".join(f"<th>{html.escape(str(c))}</th>" for c in cols)
        rows_html = ""
        for row in metrics:
            cells = "".join(
                f"<td>{html.escape(str(row.get(c, '')))}</td>" for c in cols
            )
            rows_html += f"<tr>{cells}</tr>"
        metric_rows = f"<table border='1' cellpadding='4'><tr>{header}</tr>{rows_html}</table>"

    # Plotly divs
    plot_divs = ""
    for i, pj in enumerate(plot_jsons):
        plot_divs += f"""
        <div id="plot-{i}" style="width:100%;height:500px;margin-bottom:20px;"></div>
        <script>
            Plotly.newPlot('plot-{i}', {json.dumps(json.loads(pj).get('data', []))},
                           {json.dumps(json.loads(pj).get('layout', {{}}))});
        </script>
        """

    return f"""<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <title>{title}</title>
    <script src="https://cdn.plot.ly/plotly-2.27.0.min.js"></script>
    <style>
        body {{ font-family: system-ui, sans-serif; max-width: 1000px; margin: 0 auto; padding: 20px; }}
        table {{ border-collapse: collapse; margin: 10px 0; }}
        th {{ background: #f0f0f0; }}
        td, th {{ padding: 6px 12px; text-align: left; }}
    </style>
</head>
<body>
    <h1>{title}</h1>
    <p><strong>Task:</strong> {task} | <strong>Model:</strong> {model_name}</p>
    <p><strong>Created:</strong> {html.escape(job.created_at)}</p>
    <h2>Metrics</h2>
    {metric_rows if metric_rows else "<p>No metrics available.</p>"}
    <h2>Plots</h2>
    {plot_divs if plot_divs else "<p>No plots available.</p>"}
</body>
</html>"""
