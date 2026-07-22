const { themeExtend } = require("../shared/tokens/index.cjs");

/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./entrypoints/**/*.{ts,tsx,html}",
    "./components/**/*.{ts,tsx}",
  ],
  darkMode: "class",
  theme: {
    extend: themeExtend,
  },
  plugins: [require("@tailwindcss/typography")],
};
