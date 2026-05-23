/**
 * Property-based tests for the `useConfigWriteFunnel` pure helpers
 * (`materializeOp` + `coalesceByReason`). Issue #539.
 *
 * Complements the example-based suite in
 * `./useConfigWriteFunnel.test.ts`. The example tests pin the
 * scenarios that have shipped regressions in the past (Issues #530,
 * #533); these property tests **explore the input-space
 * combinatorially** so future regressions that pick a path / value
 * combination nobody hand-listed surface at CI time anyway.
 *
 * Invariants asserted:
 *
 * 1. **`materializeOp` is a setter at the requested path**: after a
 *    `kind: "patch"`, reading the patched path back from the result
 *    yields the value that was written.
 * 2. **`materializeOp` preserves untouched siblings**: any key at the
 *    same depth as the patch root that the patch did NOT touch is
 *    present on the result with its original value.
 * 3. **`coalesceByReason(queued, next)` is replace-dominant**: if
 *    `next.kind === "replace"`, the result is exactly `next`. If
 *    `next` is a patch but `queued` is a replace, the result is the
 *    queued replace.
 * 4. **`coalesceByReason` patch-merge preserves disjoint paths**:
 *    when two patches with different paths are coalesced, both paths
 *    survive in the merged `patch-many.patches`.
 * 5. **`coalesceByReason` patch-merge prefers `next` on same path**:
 *    when two patches share a path, the merged op carries `next`'s
 *    value at that path, never `queued`'s (this is the #530 fix).
 *
 * Per `feedback_combinatorial_branch_coverage` (memory): table-drive
 * over the input-axis product; fast-check is the natural extension to
 * "every (path, value, op-kind) combination the type system permits".
 *
 * Per `feedback_count_budget_assertions` (memory): coalesce bugs are
 * storm-class — the regression that lost `model.params.objective` on
 * every auto-reset (Issue #530) only fired correctly counted PUTs.
 * Property tests fail loudly on the first counter-example.
 */

import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  type ConfigSnapshot,
  coalesceByReason,
  materializeOp,
  type PatchEntry,
  type WriteOp,
  type WriteReason,
} from "./useConfigWriteFunnel";

// --- Strategies -----------------------------------------------------------

const REASONS: readonly WriteReason[] = [
  "target-select",
  "cv-change",
  "config-form-edit",
  "undo",
  "redo",
  "apply-to-fit",
  "preset-load",
  "auto-reset",
];

const arbReason = fc.constantFrom(...REASONS);

// Path segments are constrained to a small alphabet so distinct
// strategies often pick the SAME path — exercising the
// same-path-wins-by-next branch of coalesceByReason. A wider
// alphabet would make collisions vanishingly rare and the test
// would never reach that branch.
const arbSegment = fc.constantFrom(
  "data",
  "model",
  "training",
  "evaluation",
  "split",
  "params",
  "metric",
  "objective",
  "target",
);

const arbPath = fc.array(arbSegment, { minLength: 1, maxLength: 3 });

// Leaf values: scalars + small dicts so the property tests cover
// both "literal at leaf" and "object at leaf" cases.
const arbLeaf = fc.oneof(
  fc.integer({ min: -100, max: 100 }),
  fc.string({ maxLength: 10 }),
  fc.boolean(),
  fc.constant(null),
  fc.dictionary(fc.string({ maxLength: 5 }), fc.integer(), {
    maxKeys: 3,
  }),
);

const arbPatchEntry: fc.Arbitrary<PatchEntry> = fc.record({
  path: arbPath,
  value: arbLeaf,
});

const arbPatchOp: fc.Arbitrary<WriteOp> = fc.record({
  kind: fc.constant("patch" as const),
  path: arbPath,
  value: arbLeaf,
  reason: arbReason,
});

const arbPatchManyOp: fc.Arbitrary<WriteOp> = fc.record({
  kind: fc.constant("patch-many" as const),
  patches: fc.array(arbPatchEntry, { minLength: 1, maxLength: 4 }),
  reason: arbReason,
});

// Replace ops carry a full snapshot; build it with the same path-leaf
// vocabulary so coalesce comparisons share keys.
const arbConfigSnapshot: fc.Arbitrary<ConfigSnapshot> = fc.dictionary(
  arbSegment,
  arbLeaf,
  { maxKeys: 4 },
);

const arbReplaceOp: fc.Arbitrary<WriteOp> = fc.record({
  kind: fc.constant("replace" as const),
  config: arbConfigSnapshot,
  reason: arbReason,
});

const arbWriteOp: fc.Arbitrary<WriteOp> = fc.oneof(
  arbPatchOp,
  arbPatchManyOp,
  arbReplaceOp,
);

// Helper: read a value at a dotted path, returning ``undefined`` when
// any segment is missing. Mirrors what `useConfigWriteFunnel`
// callers would do via `lodash.get` etc., but stays in this file so
// the property test has zero implementation dependency.
function readPath(snapshot: ConfigSnapshot, path: readonly string[]): unknown {
  let cur: unknown = snapshot;
  for (const seg of path) {
    if (cur === null || typeof cur !== "object" || Array.isArray(cur))
      return undefined;
    cur = (cur as Record<string, unknown>)[seg];
  }
  return cur;
}

function pathKey(path: readonly string[]): string {
  return path.join(" ");
}

/**
 * True when one of the two paths is a *strict prefix* of the other
 * (or they are equal). Property tests that assert "both paths survive
 * the materialise" only hold when the paths are disjoint at every
 * depth — when ``["data"]`` and ``["data","x"]`` collide, the
 * deeper write overwrites the prefix's scalar value with the nested
 * object, which is correct ``setNestedImmutable`` behaviour but
 * breaks the "both reach the snapshot" property.
 */
function pathsOverlap(a: readonly string[], b: readonly string[]): boolean {
  const limit = Math.min(a.length, b.length);
  for (let i = 0; i < limit; i++) {
    if (a[i] !== b[i]) return false;
  }
  // All shared positions equal — one is a prefix of (or equal to) the other.
  return true;
}

// --- Tests ----------------------------------------------------------------

describe("useConfigWriteFunnel — property-based (#539)", () => {
  // INV-1: materializeOp(patch).readPath(path) === value
  it("materializeOp[patch]: the patched path reads back the written value", () => {
    fc.assert(
      fc.property(
        arbPatchOp,
        fc.option(arbConfigSnapshot, { nil: undefined }),
        (op, current) => {
          if (op.kind !== "patch") return; // Type narrow for TS.
          const snapshot = materializeOp(op, current);
          expect(readPath(snapshot, op.path)).toStrictEqual(op.value);
        },
      ),
      { numRuns: 200 },
    );
  });

  // INV-2: materializeOp(patch) preserves untouched root-level siblings.
  it("materializeOp[patch]: untouched root keys are preserved", () => {
    fc.assert(
      fc.property(arbPatchOp, arbConfigSnapshot, (op, current) => {
        if (op.kind !== "patch") return;
        const snapshot = materializeOp(op, current);
        const rootKey = op.path[0];
        for (const key of Object.keys(current)) {
          if (key === rootKey) continue;
          expect(snapshot[key]).toStrictEqual(current[key]);
        }
      }),
      { numRuns: 200 },
    );
  });

  // INV-3a: coalesceByReason with next=replace ⇒ result is `next`.
  it("coalesceByReason: next=replace is always dominant", () => {
    fc.assert(
      fc.property(arbWriteOp, arbReplaceOp, (queued, next) => {
        const result = coalesceByReason(queued, next);
        expect(result).toStrictEqual(next);
      }),
      { numRuns: 100 },
    );
  });

  // INV-3b: queued=replace, next=patch ⇒ result preserves the replace.
  it("coalesceByReason: queued=replace, next=patch keeps the replace", () => {
    fc.assert(
      fc.property(arbReplaceOp, arbPatchOp, (queued, next) => {
        const result = coalesceByReason(queued, next);
        expect(result).toStrictEqual(queued);
      }),
      { numRuns: 100 },
    );
  });

  // INV-4: patch + patch on DIFFERENT paths ⇒ both paths survive in
  // the merged patch-many. This is the #530 fix (auto-reset's
  // model.params.objective + model.params.metric must both reach the
  // server in the same flush). "Different" means same-length distinct
  // path; prefix overlaps (["data"] vs ["data","x"]) are out-of-scope
  // because setNestedImmutable correctly overwrites the prefix scalar
  // with the deeper-write object — that is well-defined behaviour, but
  // not the property this invariant checks.
  it("coalesceByReason: disjoint patch paths both survive the merge", () => {
    fc.assert(
      fc.property(arbPatchOp, arbPatchOp, (queued, next) => {
        if (queued.kind !== "patch" || next.kind !== "patch") return;
        // Skip the same-path case — it's covered by INV-5.
        if (pathKey(queued.path) === pathKey(next.path)) return;
        const result = coalesceByReason(queued, next);
        expect(result.kind).toBe("patch-many");
        if (result.kind !== "patch-many") return;
        const keys = result.patches.map((p) => pathKey(p.path));
        expect(keys).toContain(pathKey(queued.path));
        expect(keys).toContain(pathKey(next.path));
      }),
      { numRuns: 200 },
    );
  });

  // INV-5: patch + patch on the SAME path ⇒ next's value wins. This
  // is the #530 contract: the most recent write at a path is the one
  // that ships, queued is shadowed.
  it("coalesceByReason: same-path patches resolve to next's value", () => {
    const sharedPath: readonly string[] = ["model", "params", "metric"];
    fc.assert(
      fc.property(arbReason, arbLeaf, arbLeaf, (reason, oldValue, newValue) => {
        const queued: WriteOp = {
          kind: "patch",
          path: sharedPath,
          value: oldValue,
          reason,
        };
        const next: WriteOp = {
          kind: "patch",
          path: sharedPath,
          value: newValue,
          reason,
        };
        const result = coalesceByReason(queued, next);
        expect(result.kind).toBe("patch-many");
        if (result.kind !== "patch-many") return;
        // Exactly one entry should carry our shared path, and its
        // value must be `newValue` (not `oldValue`).
        const matching = result.patches.filter(
          (p) => pathKey(p.path) === pathKey(sharedPath),
        );
        expect(matching).toHaveLength(1);
        expect(matching[0].value).toStrictEqual(newValue);
      }),
      { numRuns: 200 },
    );
  });

  // INV-6 (end-to-end): coalesce + materialise produces a snapshot
  // where the merged paths carry their final values. This is the
  // composition property that catches "coalesce drops a path that
  // materialise then can't reconstruct" regressions.
  //
  // Restricted to non-overlapping paths because prefix-overlap cases
  // (``["data"]`` vs ``["data","x"]``) intentionally have the deeper
  // write override the prefix scalar — see ``pathsOverlap`` above.
  // fast-check found this edge case on the first run; the docstring
  // and the filter together codify what *is* and *isn't* an invariant.
  it("coalesce + materialize: non-overlapping merged patches all reach the snapshot", () => {
    fc.assert(
      fc.property(
        arbPatchOp,
        arbPatchOp,
        fc.option(arbConfigSnapshot, { nil: undefined }),
        (queued, next, current) => {
          if (queued.kind !== "patch" || next.kind !== "patch") return;
          if (pathsOverlap(queued.path, next.path)) return;
          const merged = coalesceByReason(queued, next);
          const snapshot = materializeOp(merged, current);
          expect(readPath(snapshot, queued.path)).toStrictEqual(queued.value);
          expect(readPath(snapshot, next.path)).toStrictEqual(next.value);
        },
      ),
      { numRuns: 200 },
    );
  });
});
