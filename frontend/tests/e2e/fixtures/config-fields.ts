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

const splitShuffleKfold: FixtureEntry = {
  spec: {
    name: "split.shuffle (kfold) via Shuffle Switch",
    configPath: "split.shuffle",
    // The CV strategy precondition switches to kfold, which has
    // shuffle in FALLBACK_CV_STRATEGY_FIELDS. After the strategy
    // switch, useConfigSync writes split.shuffle=true (the
    // CV_FIELD_DEFAULTS.shuffle default). The user's click flips
    // it to false.
    defaultValue: true,
    testValue: false,
    // CvSection.tsx:178 renders Shuffle as
    // <div><Label>Shuffle</Label><Switch checked={cv.shuffle} ... /></div>.
    // The Switch lacks aria-label and the Label is not htmlFor-wired,
    // so anchor on the label and walk to its parent's switch descendant.
    uiLocator: (p): Locator =>
      p
        .locator('label:text-is("Shuffle")')
        .locator("..")
        .getByRole("switch"),
    uiAction: async (locator) => {
      await locator.click();
    },
  } as ConfigFieldSpec<unknown>,
  precondition: async (page) => {
    // Switch from the seeded stratified_kfold to kfold so the
    // Shuffle row mounts. KFold's FALLBACK_CV_STRATEGY_FIELDS
    // includes "shuffle"; stratified_kfold does not.
    await page.getByRole("radio", { name: "KFold", exact: true }).click();
    // Wait until the Shuffle row appears (it's the proxy for "the
    // saved config has flipped to kfold AND the conditional render
    // has settled"). Without this, the spec races the rerender
    // and the locator can resolve before the row mounts.
    await page
      .locator('label:text-is("Shuffle")')
      .first()
      .waitFor({ state: "visible", timeout: 5000 });
  },
};

const tuningTimeout: FixtureEntry = {
  spec: {
    name: "tuning.optuna.params.timeout via Timeout preset 5m",
    configPath: "tuning.optuna.params.timeout",
    // After the Tune tab precondition, saved config has tuning
    // populated but no `timeout` key. Clicking a Timeout preset
    // is the first write that lands tuning.optuna.params.timeout.
    // TIMEOUT_PRESETS at constants.ts: "5m" → 300, "10m" → 600,
    // "30m" → 1800.
    defaultValue: undefined,
    testValue: 300,
    // "5m" / "10m" / "30m" are unique Timeout preset labels —
    // N_TRIALS_PRESETS use bare numbers ("10", "50", ...) so
    // there's no overlap.
    uiLocator: (p): Locator =>
      p.getByRole("button", { name: "5m", exact: true }),
    uiAction: async (locator) => {
      await locator.click();
    },
  } as ConfigFieldSpec<unknown>,
  precondition: async (page) => {
    await page.getByRole("tab", { name: "Tune", exact: true }).click();
    await page
      .getByRole("button", { name: "Tune", exact: true })
      .first()
      .waitFor({ state: "visible", timeout: 5000 });
  },
};

/**
 * Time-series strategy preconditions share boilerplate: switch
 * via the Strategy radio and wait for the conditional row's label
 * to mount. Centralising avoids per-fixture drift.
 */
async function switchToCvStrategy(
  page: Page,
  strategyLabel: string,
  rowLabelText: string,
): Promise<void> {
  await page.getByRole("radio", { name: strategyLabel, exact: true }).click();
  await page
    .locator(`label:text-is("${rowLabelText}")`)
    .first()
    .waitFor({ state: "visible", timeout: 5000 });
}

const splitGap: FixtureEntry = {
  spec: {
    name: "split.gap (time_series) via Gap NumberInput",
    configPath: "split.gap",
    // After switching to time_series, useConfigSync writes
    // split.gap=0 (CV_FIELD_DEFAULTS.gap). Probed via tests/e2e:
    // {"method":"time_series","n_splits":5,"gap":0}.
    defaultValue: 0,
    testValue: 2,
    uiLocator: (p): Locator =>
      p.locator('label:text-is("Gap")').locator("..").getByRole("textbox"),
    uiAction: async (locator, value) => {
      await locator.fill(String(value));
      await locator.blur();
    },
  } as ConfigFieldSpec<unknown>,
  precondition: async (page) => {
    await switchToCvStrategy(page, "TimeSeriesSplit", "Gap");
  },
};

const splitPurgeGap: FixtureEntry = {
  spec: {
    name: "split.purge_gap (purged_time_series) via Purge Gap NumberInput",
    configPath: "split.purge_gap",
    // After switching to purged_time_series, useConfigSync writes
    // split.purge_gap=0 (CV_FIELD_DEFAULTS.purge_gap).
    defaultValue: 0,
    testValue: 1,
    uiLocator: (p): Locator =>
      p
        .locator('label:text-is("Purge Gap")')
        .locator("..")
        .getByRole("textbox"),
    uiAction: async (locator, value) => {
      await locator.fill(String(value));
      await locator.blur();
    },
  } as ConfigFieldSpec<unknown>,
  precondition: async (page) => {
    await switchToCvStrategy(page, "PurgedTimeSeries", "Purge Gap");
  },
};

const splitEmbargo: FixtureEntry = {
  spec: {
    name: "split.embargo (purged_time_series) via Embargo NumberInput",
    configPath: "split.embargo",
    // Same precondition as purge_gap; both fields land together
    // when the strategy switches to purged_time_series.
    defaultValue: 0,
    testValue: 1,
    uiLocator: (p): Locator =>
      p
        .locator('label:text-is("Embargo")')
        .locator("..")
        .getByRole("textbox"),
    uiAction: async (locator, value) => {
      await locator.fill(String(value));
      await locator.blur();
    },
  } as ConfigFieldSpec<unknown>,
  precondition: async (page) => {
    await switchToCvStrategy(page, "PurgedTimeSeries", "Embargo");
  },
};

const splitTrainSizeMax: FixtureEntry = {
  spec: {
    name: "split.train_size_max (time_series) via Train Size Max NumberInput",
    configPath: "split.train_size_max",
    // The NullableNumberField at CvSection.tsx:267 uses autoHint=true,
    // so the input renders empty by default and the saved config
    // omits split.train_size_max until the user types. defaultValue
    // is undefined; testValue=50 is the first write.
    defaultValue: undefined,
    testValue: 50,
    // The Label includes a "(empty = auto)" hint span, so :text-is
    // does not match. Use hasText filter instead.
    uiLocator: (p): Locator =>
      p
        .locator("label")
        .filter({ hasText: "Train Size Max" })
        .locator("..")
        .getByRole("textbox"),
    uiAction: async (locator, value) => {
      await locator.fill(String(value));
      await locator.blur();
    },
  } as ConfigFieldSpec<unknown>,
  precondition: async (page) => {
    await switchToCvStrategy(page, "TimeSeriesSplit", "Gap");
    // Train Size Max sits below Gap; wait for its label too so the
    // locator is reachable when assertConfigReflection resolves it.
    await page
      .locator("label")
      .filter({ hasText: "Train Size Max" })
      .first()
      .waitFor({ state: "visible", timeout: 5000 });
  },
};

const splitTestSizeMax: FixtureEntry = {
  spec: {
    name: "split.test_size_max (time_series) via Test Size Max NumberInput",
    configPath: "split.test_size_max",
    defaultValue: undefined,
    testValue: 25,
    uiLocator: (p): Locator =>
      p
        .locator("label")
        .filter({ hasText: "Test Size Max" })
        .locator("..")
        .getByRole("textbox"),
    uiAction: async (locator, value) => {
      await locator.fill(String(value));
      await locator.blur();
    },
  } as ConfigFieldSpec<unknown>,
  precondition: async (page) => {
    await switchToCvStrategy(page, "TimeSeriesSplit", "Gap");
    await page
      .locator("label")
      .filter({ hasText: "Test Size Max" })
      .first()
      .waitFor({ state: "visible", timeout: 5000 });
  },
};

/**
 * Calibration fields require enabling the Calibration switch
 * first; the CalibrationSection at CalibrationSection.tsx mounts
 * the method Select + n_splits NumberInput inside the
 * AccordionContent only when calibration is non-null.
 */
async function enableCalibration(page: Page): Promise<void> {
  // Toggle ON first — the AccordionContent only renders when
  // calibration is non-null (CalibrationSection.tsx:68).
  await page
    .getByRole("switch", { name: "Calibration", exact: true })
    .click();
  // ConfigForm's Accordion `defaultValue` does NOT include
  // "calibration" (ConfigForm.tsx:420), so the AccordionItem is
  // collapsed by default. Click the trigger to expand the content.
  // The trigger text is "Calibration" — `exact: true` against the
  // role=button matcher pins it (the Switch above shares the
  // same accessible name but role=switch, not role=button).
  await page
    .getByRole("button", { name: "Calibration", exact: true })
    .click();
  await page
    .getByRole("combobox", { name: "Calibration method" })
    .waitFor({ state: "visible", timeout: 5000 });
}

const calibrationMethod: FixtureEntry = {
  spec: {
    name: "calibration.method via Calibration method Select",
    configPath: "calibration.method",
    // CALIBRATION_DEFAULTS at constants.ts: method=isotonic,
    // n_splits=5. After enabling, saved config has these values.
    defaultValue: "isotonic",
    testValue: "platt",
    uiLocator: (p): Locator =>
      p.getByRole("combobox", { name: "Calibration method" }),
    uiAction: async (locator, value) => {
      await locator.click();
      await locator
        .page()
        .getByRole("option", { name: String(value), exact: true })
        .click();
    },
  } as ConfigFieldSpec<unknown>,
  precondition: enableCalibration,
};

const calibrationNSplits: FixtureEntry = {
  spec: {
    name: "calibration.n_splits via Calibration n_splits NumberInput",
    configPath: "calibration.n_splits",
    defaultValue: 5,
    testValue: 7,
    // CalibrationSection.tsx:93 wraps the n_splits row as
    //   <div class="flex ..."><div><Label>n_splits</Label><p>...</p></div><NumberInput/></div>
    // so we walk up TWO levels from the label (`../..`) to hit the
    // outer flex container which scopes the textbox lookup.
    uiLocator: (p): Locator =>
      p
        .locator('label:text-is("n_splits")')
        .locator("../..")
        .getByRole("textbox"),
    uiAction: async (locator, value) => {
      await locator.fill(String(value));
      await locator.blur();
    },
  } as ConfigFieldSpec<unknown>,
  precondition: enableCalibration,
};

const dataGroupCol: FixtureEntry = {
  spec: {
    name: "data.group_col (group_kfold) via Group column Select",
    configPath: "data.group_col",
    // After switching to group_kfold, applyCvDataFields injects
    // data.group_col=null (because cv.groupCol is null until the
    // user picks). Probed via tests/e2e:
    // data = { path, target, time_col: null, group_col: null }.
    defaultValue: null,
    testValue: "gender",
    // CvSection's Group column Select carries an explicit
    // aria-label, so getByRole resolves it directly.
    uiLocator: (p): Locator =>
      p.getByRole("combobox", { name: "Group column", exact: true }),
    uiAction: async (locator, value) => {
      await locator.click();
      await locator
        .page()
        .getByRole("option", { name: String(value), exact: true })
        .click();
    },
  } as ConfigFieldSpec<unknown>,
  precondition: async (page) => {
    await page.getByRole("radio", { name: "GroupKFold", exact: true }).click();
    // The Group column trigger materialises once the strategy
    // reconciles into local state.
    await page
      .getByRole("combobox", { name: "Group column", exact: true })
      .waitFor({ state: "visible", timeout: 5000 });
  },
};

const dataTimeCol: FixtureEntry = {
  spec: {
    name: "data.time_col (time_series) via Time column Select",
    configPath: "data.time_col",
    defaultValue: null,
    testValue: "age",
    uiLocator: (p): Locator =>
      p.getByRole("combobox", { name: "Time column", exact: true }),
    uiAction: async (locator, value) => {
      await locator.click();
      await locator
        .page()
        .getByRole("option", { name: String(value), exact: true })
        .click();
    },
  } as ConfigFieldSpec<unknown>,
  precondition: async (page) => {
    await page
      .getByRole("radio", { name: "TimeSeriesSplit", exact: true })
      .click();
    await page
      .getByRole("combobox", { name: "Time column", exact: true })
      .waitFor({ state: "visible", timeout: 5000 });
  },
};

/**
 * Phase C wave 8: 22 fields. Adds the two `data.*_col` Selects
 * gated by their respective CV strategies (group_kfold for
 * group_col, time_series for time_col). Both use defaultValue=null
 * because applyCvDataFields injects null until the user picks a
 * column from the dropdown.
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
  splitShuffleKfold,
  tuningTimeout,
  splitGap,
  splitPurgeGap,
  splitEmbargo,
  splitTrainSizeMax,
  splitTestSizeMax,
  calibrationMethod,
  calibrationNSplits,
  dataGroupCol,
  dataTimeCol,
];
