import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: "class",
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
        sidebar: {
          DEFAULT: "hsl(var(--sidebar-background))",
          foreground: "hsl(var(--sidebar-foreground))",
          primary: "hsl(var(--sidebar-primary))",
          "primary-foreground": "hsl(var(--sidebar-primary-foreground))",
          accent: "hsl(var(--sidebar-accent))",
          "accent-foreground": "hsl(var(--sidebar-accent-foreground))",
          border: "hsl(var(--sidebar-border))",
          ring: "hsl(var(--sidebar-ring))",
        },
        chart: {
          "1": "hsl(var(--chart-1))",
          "2": "hsl(var(--chart-2))",
          "3": "hsl(var(--chart-3))",
          "4": "hsl(var(--chart-4))",
          "5": "hsl(var(--chart-5))",
        },
        // H-0078 (B-9): semantic status colors. Each token maps onto
        // its ``--lzs-*-bg`` / ``-fg`` / ``-border`` CSS custom
        // property so dark-mode inversion is handled in one place
        // (design-tokens.css) rather than by every consumer writing
        // ``bg-green-100 dark:bg-green-900``.
        //
        // Usage:
        //   bg-success       → ``background-color: var(--lzs-success-bg)``
        //   text-success     → ``color: var(--lzs-success-fg)``
        //   border-success   → ``border-color: var(--lzs-success-border)``
        //   bg-success-solid / text-success-solid-fg — intense badge.
        //   text-degraded    → ``color: var(--lzs-degraded-fg)`` (text only)
        success: {
          DEFAULT: "var(--lzs-success-bg)",
          fg: "var(--lzs-success-fg)",
          border: "var(--lzs-success-border)",
          solid: "var(--lzs-success-solid-bg)",
          "solid-fg": "var(--lzs-success-solid-fg)",
        },
        warning: {
          DEFAULT: "var(--lzs-warning-bg)",
          fg: "var(--lzs-warning-fg)",
          border: "var(--lzs-warning-border)",
        },
        danger: {
          DEFAULT: "var(--lzs-danger-bg)",
          fg: "var(--lzs-danger-fg)",
          border: "var(--lzs-danger-border)",
        },
        info: {
          DEFAULT: "var(--lzs-info-bg)",
          fg: "var(--lzs-info-fg)",
          "strong-fg": "var(--lzs-info-strong-fg)",
          border: "var(--lzs-info-border)",
        },
        degraded: {
          fg: "var(--lzs-degraded-fg)",
        },
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
    },
  },
  plugins: [],
};

export default config;
