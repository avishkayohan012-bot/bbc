import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: "class",
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        "bg-primary": "var(--bg-primary)",
        "bg-card": "var(--bg-card)",
        "bg-input": "var(--bg-input)",
        accent: "var(--accent)",
        "accent-hover": "var(--accent-hover)",
        "accent-dim": "var(--accent-dim)",
      },
    },
  },
  plugins: [],
};

export default config;
