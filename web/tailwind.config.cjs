const { themeExtend } = require("../shared/tokens/index.cjs");

/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  darkMode: "media",
  theme: {
    extend: themeExtend,
  },
  plugins: [],
};
