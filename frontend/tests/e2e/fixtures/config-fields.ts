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

/**
 * Phase C wave 2: 4 fields covering NumberInput + Switch shapes
 * across 3 sections (split / model / training). Adding a fixture
 * row in the next PR is the unit of work for extending coverage
 * to all 32+ Config fields enumerated in gui-e2e-plan §A.
 */
export const CONFIG_FIELD_FIXTURES: FixtureEntry[] = [
  splitNSplits,
  modelBalanced,
  trainingSeed,
  earlyStoppingRounds,
];
