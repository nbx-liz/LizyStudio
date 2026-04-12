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
  edge: "lower" | "upper" | "mid" | "none";
  expanded: boolean;
  new_low: number | null;
  new_high: number | null;
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
