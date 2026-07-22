/**
 * Design tokens shared by extension/tailwind.config.cjs and web/tailwind.config.cjs
 * (plan.md Project Structure). Plain CommonJS so both Tailwind configs can
 * `require()` it directly with no build step. Values are the ones already in
 * use by the extension (extension/assets/main.css, extension/tailwind.config.cjs)
 * — this module names them, it does not change them.
 */

const colors = {
  surface: {
    light: "#f9fafb",
    dark: "#0f1117",
  },
};

const fontFamily = {
  sans: ["Inter", "system-ui", "sans-serif"],
};

/** Tailwind `theme.extend` fragment consumed by both packages' configs. */
const themeExtend = {
  maxWidth: {
    panel: "400px",
  },
  fontFamily,
  colors: {
    surface: colors.surface,
  },
};

module.exports = { colors, fontFamily, themeExtend };
