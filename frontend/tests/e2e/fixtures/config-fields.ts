import type { Locator, Page } from "@playwright/test";
import type { ConfigFieldSpec } from "../helpers/config-reflection";

/**
 * Phase C (gui-e2e-plan §4.2) — fixture data driving the
 * config-reflection invariant generator.
 *
 * Each entry declares the smallest unit needed to lock the
 * "UI control → PUT /config" wire path for one Config field.
 * The accompanying spec file (workspace-config-fields-loop.spec.ts)
 * loops `assertConfigReflection` over this list, so adding coverage
 * for a new field is one fixture row instead of one new spec.
 *
 * Conventions:
 *
 * - All entries assume the seed step has put the workspace on the
 *   Fit tab with the Model section already mounted (the default
 *   state after `seedUiWorkspace`). Fields that need a different
 *   precondition (Tune tab, mobile section open, CV strategy
 *   switch) belong in a separate fixture file or a dedicated spec.
 * - `defaultValue` is the value the saved config holds AFTER
 *   `seedUiWorkspace` returns and the funnel has quiesced. If the
 *   value depends on the seed (e.g. binary classification picks
 *   stratified_kfold and n_splits=5), encode that assumption here
 *   and add a sanity guard in the spec body so a seed-default
 *   change fails loudly instead of silently mismatching.
 * - Locators must resolve uniquely on the post-seed page. Use
 *   accessible-name selectors (`getByRole(..., { name })`,
 *   `getByLabel`) over CSS class chains so the fixture survives
 *   shadcn/ui style refactors.
 */

/**
 * Fixture wrapper that ties the spec to the precondition it needs.
 * Today every entry assumes "post-seedUiWorkspace, Fit tab, Model
 * section mounted". Future fixtures (Tune tab, mobile, strategy
 * switch) attach their precondition via this same field.
 */
export interface FixtureEntry {
  spec: ConfigFieldSpec<unknown>;
  /**
   * Optional precondition driver run AFTER `seedUiWorkspace` and
   * BEFORE the spec's locator resolves. Used for fields that need
   * a tab switch, accordion open, or strategy change before the
   * control is mountable. Today's fixtures don't need any.
   */
  precondition?: (page: Page) => Promise<void>;
}

const splitNSplits: FixtureEntry = {
  spec: {
    name: "split.n_splits via Folds NumberInput",
    configPath: "split.n_splits",
    defaultValue: 5,
    testValue: 7,
    // CvSection's Folds NumberInput sets ariaLabel="Folds" so the
    // <input> surfaces as role=textbox with that accessible name.
    uiLocator: (p): Locator =>
      p.getByRole("textbox", { name: "Folds", exact: true }),
    uiAction: async (locator, value) => {
      await locator.fill(String(value));
      await locator.blur();
    },
  } as ConfigFieldSpec<unknown>,
};

const modelBalanced: FixtureEntry = {
  spec: {
    name: "model.balanced via Smart Params Balanced switch",
    configPath: "model.balanced",
    // For binary classification (the seed task) lizyml's defaults
    // endpoint leaves model.balanced as null (the Pydantic optional
    // default). The Switch UI treats null/undefined/false as "off"
    // — see renderBooleanField at field-renderers.tsx:104.
    defaultValue: null,
    testValue: true,
    // FormField wires <Label htmlFor> to the Switch's underlying
    // role=switch button. Issue #265 already locks "exactly one
    // Balanced switch" so this getByRole match is unambiguous.
    uiLocator: (p): Locator => p.getByRole("switch", { name: "Balanced" }),
    uiAction: async (locator) => {
      await locator.click();
    },
  } as ConfigFieldSpec<unknown>,
};

const trainingSeed: FixtureEntry = {
  spec: {
    name: "training.seed via Seed NumberInput",
    configPath: "training.seed",
    // lizyml defaults endpoint sets training.seed=42 for binary tasks.
    defaultValue: 42,
    testValue: 7,
    // FormField wires <Label htmlFor> to the NumberInput's underlying
    // <input>. The schema-rendered Training section produces a
    // unique "Seed" label (no other "Seed" textbox is visible after
    // seedUiWorkspace). Using getByRole+name avoids the deeply
    // nested locator chain that would otherwise be required.
    uiLocator: (p): Locator =>
      p.getByRole("textbox", { name: "Seed", exact: true }),
    uiAction: async (locator, value) => {
      await locator.fill(String(value));
      await locator.blur();
    },
  } as ConfigFieldSpec<unknown>,
};

const earlyStoppingRounds: FixtureEntry = {
  spec: {
    name: "training.early_stopping.rounds via Rounds NumberInput",
    configPath: "training.early_stopping.rounds",
    // lizyml defaults endpoint sets training.early_stopping.rounds=150
    // for binary tasks.
    defaultValue: 150,
    testValue: 75,
    // "Rounds" is unique to early_stopping in the post-seed Fit form.
    uiLocator: (p): Locator =>
      p.getByRole("textbox", { name: "Rounds", exact: true }),
    uiAction: async (locator, value) => {
      await locator.fill(String(value));
      await locator.blur();
    },
  } as ConfigFieldSpec<unknown>,
};

const earlyStoppingEnabled: FixtureEntry = {
  spec: {
    name: "training.early_stopping.enabled via Enabled Switch",
    configPath: "training.early_stopping.enabled",
    // lizyml defaults endpoint sets training.early_stopping.enabled=true
    // for binary tasks. Toggling it OFF locks the regression where the
    // form's Switch flips but the wire body retains the prior value.
    defaultValue: true,
    testValue: false,
    // "Enabled" is unique to training.early_stopping in the post-seed
    // Fit form — calibration uses a different switch label.
    uiLocator: (p): Locator => p.getByRole("switch", { name: "Enabled" }),
    uiAction: async (locator) => {
      await locator.click();
    },
  } as ConfigFieldSpec<unknown>,
};

const modelAutoNumLeaves: FixtureEntry = {
  spec: {
    name: "model.auto_num_leaves via Auto Num Leaves Switch",
    configPath: "model.auto_num_leaves",
    // lizyml defaults endpoint sets model.auto_num_leaves=true for
    // binary tasks. Toggling OFF disables num_leaves_ratio in the
    // UI but the Switch itself drives a clean wire write.
    defaultValue: true,
    testValue: false,
    uiLocator: (p): Locator =>
      p.getByRole("switch", { name: "Auto Num Leaves" }),
    uiAction: async (locator) => {
      await locator.click();
    },
  } as ConfigFieldSpec<unknown>,
};

const modelNumLeavesRatio: FixtureEntry = {
  spec: {
    name: "model.num_leaves_ratio via Num Leaves Ratio NumberInput",
    configPath: "model.num_leaves_ratio",
    // Default = 1 (per the rendered Smart Params section). NOTE:
    // this control is enabled only while auto_num_leaves=true (the
    // seed default). The auto_num_leaves fixture above runs in its
    // own isolated workspace (beforeEach reset) so this fixture
    // sees the seeded auto=true state.
    //
    // testValue stays inside the UI default_range of [0.5, 1.0]
    // (lizyml_ui_schema.py default_range hint) — values outside
    // that hint occasionally round-trip back to the default at the
    // server boundary.
    defaultValue: 1,
    testValue: 0.7,
    uiLocator: (p): Locator =>
      p.getByRole("textbox", { name: "Num Leaves Ratio", exact: true }),
    uiAction: async (locator, value) => {
      await locator.fill(String(value));
      await locator.blur();
    },
  } as ConfigFieldSpec<unknown>,
};

const modelMinDataInLeafRatio: FixtureEntry = {
  spec: {
    name: "model.min_data_in_leaf_ratio via Min Data In Leaf Ratio NumberInput",
    configPath: "model.min_data_in_leaf_ratio",
    // Default = 0.01 per the Smart Params block. The schema marks
    // this nullable, but lizyml's defaults endpoint always emits
    // a numeric value.
    defaultValue: 0.01,
    testValue: 0.05,
    uiLocator: (p): Locator =>
      p.getByRole("textbox", { name: "Min Data In Leaf Ratio", exact: true }),
    uiAction: async (locator, value) => {
      await locator.fill(String(value));
      await locator.blur();
    },
  } as ConfigFieldSpec<unknown>,
};

const modelMinDataInBinRatio: FixtureEntry = {
  spec: {
    name: "model.min_data_in_bin_ratio via Min Data In Bin Ratio NumberInput",
    configPath: "model.min_data_in_bin_ratio",
    defaultValue: 0.01,
    testValue: 0.05,
    uiLocator: (p): Locator =>
      p.getByRole("textbox", { name: "Min Data In Bin Ratio", exact: true }),
    uiAction: async (locator, value) => {
      await locator.fill(String(value));
      await locator.blur();
    },
  } as ConfigFieldSpec<unknown>,
};

const splitRandomState: FixtureEntry = {
  spec: {
    name: "split.random_state via Random State NumberInput",
    configPath: "split.random_state",
    // The post-seed saved config does NOT include split.random_state
    // — useTargetSelection's buildMergedConfig writes only
    // { method, n_splits } (useDataPanel.types.ts:72), and the
    // post-target useConfigSync run is skipped via preseedSyncKey.
    // The user's click on the Random State NumberInput is the FIRST
    // event that flushes split.random_state into the wire body.
    // Local cv.randomState is 42 the whole time — that's the value
    // the input shows — but the saved config has no key for it
    // until the user types.
    defaultValue: undefined,
    testValue: 7,
    // CvSection.tsx:162 renders the Random State block as
    // <div><Label>Random State</Label><NumberInput .../></div>.
    // The NumberInput has no aria-label (the surrounding Label is
    // not htmlFor-wired because CvSection uses bare Label + control,
    // not the schema-driven FormField). Anchor on the label and walk
    // to the parent div's textbox descendant.
    uiLocator: (p): Locator =>
      p
        .locator('label:text-is("Random State")')
        .locator("..")
        .getByRole("textbox"),
    uiAction: async (locator, value) => {
      await locator.fill(String(value));
      await locator.blur();
    },
  } as ConfigFieldSpec<unknown>,
};

const tuningNTrials: FixtureEntry = {
  spec: {
    name: "tuning.optuna.params.n_trials via N Trials preset 100",
    configPath: "tuning.optuna.params.n_trials",
    // After the Tune tab precondition fires, the saved config has
    // tuning = { optuna: { params: { direction: "maximize" } } }
    // (probed via tests/e2e). n_trials is undefined until the
    // user clicks a preset; the SegmentedControl's local fallback
    // of 50 is the displayed default but does NOT land in the
    // saved config until a preset is selected.
    defaultValue: undefined,
    testValue: 100,
    // The TuneSettings SegmentedControl renders each N_TRIALS_PRESETS
    // value as a <button> with the value as text. Presets are
    // [10, 50, 100, 200, 500] so "100" is unambiguous (no other
    // button on the Tune tab carries the literal text "100" —
    // TIMEOUT_PRESETS use "None"/"5m"/"10m"/"30m").
    uiLocator: (p): Locator =>
      p.getByRole("button", { name: "100", exact: true }),
    uiAction: async (locator) => {
      await locator.click();
    },
  } as ConfigFieldSpec<unknown>,
  precondition: async (page) => {
    // Switch from Fit (default) to Tune so the SegmentedControl
    // mounts. The Settings accordion is open by default inside the
    // Tune tab's left rail.
    await page.getByRole("tab", { name: "Tune", exact: true }).click();
    // Wait for the Tune action button to appear so the tab content
    // has finished mounting before the spec resolves the locator.
    await page
      .getByRole("button", { name: "Tune", exact: true })
      .first()
      .waitFor({ state: "visible", timeout: 5000 });
  },
};

/**
 * Phase C wave 4: 11 fields. Adds split.random_state (no
 * precondition — visible on the seed default of stratified_kfold)
 * and tuning.optuna.params.n_trials (precondition: switch to the
 * Tune tab so the SegmentedControl mounts). The Tune-tab fixture
 * is the first precondition entry — it validates that the loop
 * spec correctly invokes `precondition` before resolving the
 * locator.
 */
export const CONFIG_FIELD_FIXTURES: FixtureEntry[] = [
  splitNSplits,
  modelBalanced,
  trainingSeed,
  earlyStoppingRounds,
  earlyStoppingEnabled,
  modelAutoNumLeaves,
  modelNumLeavesRatio,
  modelMinDataInLeafRatio,
  modelMinDataInBinRatio,
  splitRandomState,
  tuningNTrials,
];
