// Regression harness for the `Nightly streak monitor` github-script body.
//
// Usage: node streak_monitor_harness.mjs <path-to-extracted-script.js>
//
// The monitor lives inline in `.github/workflows/nightly-streak-monitor.yml`
// as an `actions/github-script` body, so it cannot be imported directly.
// `test_nightly_streak_monitor.py` extracts that body from the YAML and
// hands the path to this harness, which runs it against stubbed
// `github` / `context` / `core` objects and asserts on the side effects.
//
// Why this exists: `nightly.yml`'s idle-night `guard` job makes every
// tracked job report `skipped` on a night when develop did not move. The
// original streak logic (`conclusions.every(c => c === "failure")`) treats
// a `skipped` run as "not a failure", so a quiet week would silently break
// an ongoing red streak and the alert would stop firing — a false-clean
// detection loss, not a false alarm. T2 below is the pinned regression.

import { readFileSync } from "node:fs";

const scriptPath = process.argv[2];
if (!scriptPath) {
  console.error("usage: node streak_monitor_harness.mjs <script.js>");
  process.exit(2);
}
const script = readFileSync(scriptPath, "utf8");
const runMonitor = new Function(
  "github",
  "context",
  "core",
  `return (async () => {${script}})()`,
);

const TRACKED_JOBS = [
  "mutation-test",
  "E2E visual + a11y (Nightly, non-blocking)",
];

function makeStubs({ runs, jobsByRun, triggerRunId }) {
  const issueActions = [];
  const logs = [];
  const github = {
    rest: {
      actions: {
        listWorkflowRuns: async () => ({ data: { workflow_runs: runs } }),
        listJobsForWorkflowRun: async ({ run_id }) => ({
          data: { jobs: jobsByRun[run_id] ?? [] },
        }),
      },
      issues: {
        listForRepo: async () => ({ data: [] }),
        create: async (a) => {
          issueActions.push(["create", a.title]);
          return { data: { number: 1 } };
        },
        createComment: async (a) => issueActions.push(["comment", a.issue_number]),
        update: async (a) => issueActions.push(["update", a.issue_number]),
      },
    },
  };
  const context = {
    repo: { owner: "o", repo: "r" },
    payload: triggerRunId ? { workflow_run: { id: triggerRunId } } : {},
  };
  const core = {
    info: (m) => logs.push(m),
    notice: (m) => logs.push(m),
  };
  return { github, context, core, issueActions, logs };
}

// `pattern` is newest-first, mirroring the order the REST API returns runs
// in. The idle-night guard skips every gated job together, so both tracked
// jobs share a run's conclusion — the fixture keeps that faithful.
function history(pattern) {
  const runs = pattern.map((_, i) => ({
    id: 1000 + i,
    html_url: `https://example.invalid/run/${i}`,
    created_at: `2026-07-${String(i + 1).padStart(2, "0")}T17:00:00Z`,
  }));
  const jobsByRun = {};
  pattern.forEach((conclusion, i) => {
    jobsByRun[1000 + i] = TRACKED_JOBS.map((name) => ({ name, conclusion }));
  });
  return { runs, jobsByRun };
}

const CASES = [
  {
    name: "T1 trigger run skipped every tracked job -> early return, no evaluation",
    pattern: ["skipped", "failure", "failure", "failure", "failure", "failure"],
    expect: (s) =>
      s.issueActions.length === 0 && s.logs.some((m) => /idle-night guard/.test(m)),
  },
  {
    name: "T2 five EXECUTED failures interleaved with skipped runs -> alert still fires",
    pattern: [
      "failure", "skipped", "skipped", "failure", "skipped",
      "failure", "skipped", "failure", "skipped", "failure",
    ],
    expect: (s) => s.issueActions.some(([kind]) => kind === "create"),
  },
  {
    name: "T3 fewer than STREAK_THRESHOLD executed runs in window -> no alert",
    pattern: ["failure", "skipped", "skipped", "failure", "skipped", "failure"],
    expect: (s) =>
      s.issueActions.length === 0 &&
      s.logs.some((m) => /skipping streak evaluation/.test(m)),
  },
  {
    name: "T4 an executed success breaks the streak -> no alert",
    pattern: ["success", "failure", "failure", "failure", "failure", "failure"],
    expect: (s) => !s.issueActions.some(([kind]) => kind === "create"),
  },
  {
    name: "T5 pre-guard behaviour preserved: five consecutive failures, no skips -> alert",
    pattern: ["failure", "failure", "failure", "failure", "failure"],
    expect: (s) => s.issueActions.some(([kind]) => kind === "create"),
  },
];

let failed = 0;
for (const testCase of CASES) {
  const { runs, jobsByRun } = history(testCase.pattern);
  const stubs = makeStubs({ runs, jobsByRun, triggerRunId: runs[0].id });
  await runMonitor(stubs.github, stubs.context, stubs.core);
  const ok = testCase.expect(stubs);
  if (!ok) {
    failed += 1;
    console.log(`FAIL  ${testCase.name}`);
    console.log(`   issueActions: ${JSON.stringify(stubs.issueActions)}`);
    console.log(`   logs:\n     ${stubs.logs.join("\n     ")}`);
  } else {
    console.log(`PASS  ${testCase.name}`);
  }
}
process.exit(failed === 0 ? 0 : 1);
