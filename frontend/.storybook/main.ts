import type { StorybookConfig } from "@storybook/react-vite";

// Storybook 10 (2026-04-14 bump): the legacy ``@storybook/addon-essentials``
// umbrella was deprecated and folded into the core package. Docs / Controls /
// Actions / Viewport / Backgrounds / Toolbars / Measure / Outline are now
// always available without an explicit dep. We keep ``addon-a11y`` because
// that one is still distributed separately.
const config: StorybookConfig = {
  stories: ["../src/**/*.stories.@(ts|tsx)"],
  addons: ["@storybook/addon-a11y"],
  framework: {
    name: "@storybook/react-vite",
    options: {},
  },
};
export default config;
