/**
 * Tailwind CSS configuration.
 *
 * We enable JIT mode by default. The content array points to the HTML
 * and React component files so Tailwind can purge unused styles.
 */
module.exports = {
  content: [
    './index.html',
    './src/**/*.{js,jsx,ts,tsx}',
  ],
  theme: {
    extend: {},
  },
  plugins: [],
};
