/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./entrypoints/**/*.{ts,tsx,html}",
    "./components/**/*.{ts,tsx}",
  ],
  darkMode: "class",
  theme: {
    extend: {
      maxWidth: {
        panel: "400px",
      },
    },
  },
  plugins: [require("@tailwindcss/typography")],
};
