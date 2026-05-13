export interface TuneRound {
  round: number;
  n_trials: number;
  best_score_before: number | null;
  best_score_after: number | null;
  expanded_dims: string[];
  space_snapshot?: Record<string, unknown>[] | null;
}

export interface BoundaryDimStatus {
  name: string;
  best_value: number | string | null;
  low: number | null;
  high: number | null;
  position_pct: number | null;
  // lizyml 0.9.0 emits only "lower" | "upper" | "none"
  edge: "lower" | "upper" | "none";
  expanded: boolean;
  new_low: number | null;
  new_high: number | null;
  // P-0104 Wave 3.1b / Issue #461: lizyml v0.15 sets this when a proposed
  // boundary expansion was clipped by ``parameter_bounds`` (the hard
  // library limit). Older lizyml versions / single-round tunes omit it,
  // so the serializer defaults it to ``false``.
  clamped_to_bound: boolean;
}

export interface BoundaryReport {
  dims: BoundaryDimStatus[];
  expanded_names: string[];
}

export interface RetuneConfig {
  n_rounds: number;
  expand_boundary: boolean;
  boundary_threshold: number;
}
