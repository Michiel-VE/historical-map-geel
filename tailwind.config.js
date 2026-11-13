/** @type {import('tailwindcss').Config} */
const plugin = require('tailwindcss/plugin');

// Single source of truth for the look of the app.
// Change a value here and every class that uses it follows.
const colors = {
  canvas: '#f8f9fa',

  // Surfaces (panel, cards, search box, drawer)
  panel: {
    DEFAULT: '#ffffff',
    subtle: '#f8fafc',
    hover: '#f1f5f9',
    muted: '#e2e8f0',
  },

  // Dark UI chrome (toggle button, hint banner, selected states)
  primary: {
    DEFAULT: '#1e293b',
    hover: '#334155',
    dark: '#0f172a',
  },

  // Historical amber (region blobs, progress bar, onboarding)
  accent: {
    DEFAULT: '#f59e0b',
    dark: '#b45309',
    deep: '#78350f',
    light: '#fcd34d',
    wash: '#fffbeb',
    ink: '#92400e',
  },

  // Borders and dividers
  line: {
    DEFAULT: '#cbd5e1',
    soft: '#e2e8f0',
    strong: '#94a3b8',
  },

  // Text
  ink: {
    base: '#111111',
    DEFAULT: '#1e293b',
    strong: '#0f172a',
    medium: '#334155',
    soft: '#475569',
    faint: '#64748b',
    title: '#2c3e50',
  },

  // One colour pair per map layer: DEFAULT = fill, edge = outline.
  // The layer checkboxes use these, so panel and map share one legend.
  layer: {
    parcels: { DEFAULT: '#f59e0b', edge: '#b45309' },
    roads: { DEFAULT: '#475569', edge: '#334155' },
    waterways: { DEFAULT: '#0284c7', edge: '#0369a1' },
    housing: { DEFAULT: '#e11d48', edge: '#9f1239' },
  },

  link: '#0369a1',
  focus: { DEFAULT: '#1d4ed8', map: '#2563eb' },
  success: '#16a34a',
  danger: '#dc2626',
  skeleton: '#e9eef3',
};

const sweep = (mid) => `linear-gradient(100deg, transparent 20%, ${mid} 50%, transparent 80%)`;
const gridLines = (deg) =>
  `repeating-linear-gradient(${deg}deg, transparent 0 3rem, rgba(148,163,184,0.18) 3rem calc(3rem + 1px))`;

module.exports = {
  content: ['./index.html', './*.js', './js/**/*.js'],

  theme: {
    extend: {
      colors,

      fontFamily: {
        sans: ['-apple-system', 'BlinkMacSystemFont', '"Segoe UI"', 'Roboto', 'Arial', 'sans-serif'],
      },

      // Named sizes used by the interface
      fontSize: {
        micro: '0.6875rem',
        small: '0.8125rem',
        ui: '0.9375rem',
        title: '1.375rem',
      },
      letterSpacing: { snug: '-0.01em' },

      // `border` on its own now uses the theme line colour
      borderColor: { DEFAULT: colors.line.DEFAULT },
      borderRadius: { card: '0.875rem' },

      boxShadow: {
        panel: '0 0.25rem 0.75rem rgba(15,23,42,0.05)',
        float: '0 1rem 2.5rem -0.5rem rgba(15,23,42,0.15)',
        control: '0 0 0 1px rgba(15,23,42,0.15), 0 2px 6px rgba(15,23,42,0.15)',
      },

      transitionTimingFunction: { smooth: 'cubic-bezier(0.4, 0, 0.2, 1)' },

      // App shell. Mobile = map on top, panel + footer below. md+ = panel left, map right.
      gridTemplateColumns: {
        app: '25rem minmax(0, 1fr)',
        'app-rail': '3.5rem minmax(0, 1fr)',
        'app-stack': 'minmax(0, 1fr)',
        regions: 'repeat(auto-fill, minmax(8.5rem, 1fr))',
      },
      gridTemplateRows: {
        app: 'minmax(0, 1fr) auto',
        'app-stack': '55vh minmax(0, 1fr) auto',
        'app-stack-rail': 'minmax(0, 1fr) 3rem auto',
      },

      backgroundImage: {
        progress: `linear-gradient(90deg, ${colors.accent.DEFAULT}, ${colors.accent.light}, ${colors.accent.DEFAULT})`,
        'shimmer-light': sweep('rgba(255,255,255,0.75)'),
        'shimmer-map': sweep('rgba(255,255,255,0.6)'),
        'shimmer-search': sweep('rgba(148,163,184,0.22)'),
        'map-grid': `${gridLines(0)}, ${gridLines(90)}`,
        'search-icon':
          "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 24 24' stroke='%2364748b' stroke-width='2' width='18' height='18'%3E%3Cpath stroke-linecap='round' stroke-linejoin='round' d='M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z'/%3E%3C/svg%3E\")",
      },

      keyframes: {
        'sk-slide': { from: { transform: 'translateX(-100%)' }, to: { transform: 'translateX(100%)' } },
        'sk-reveal': {
          from: { opacity: '0', transform: 'translateY(0.375rem)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        'lb-shimmer': { from: { backgroundPosition: '0 0' }, to: { backgroundPosition: '-200% 0' } },
        'ob-in': {
          from: { opacity: '0', transform: 'translateY(0.75rem)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        'ob-pulse': {
          '0%': { boxShadow: '0 0 0 0 rgba(245,158,11,0.55)' },
          '70%': { boxShadow: '0 0 0 0.625rem rgba(245,158,11,0)' },
          '100%': { boxShadow: '0 0 0 0 rgba(245,158,11,0)' },
        },
      },
      animation: {
        sweep: 'sk-slide 1.4s ease-in-out infinite',
        'sweep-slow': 'sk-slide 1.6s ease-in-out infinite',
        'sweep-search': 'sk-slide 1.5s ease-in-out infinite',
        reveal: 'sk-reveal 0.45s ease both',
        shimmer: 'lb-shimmer 1.4s linear infinite',
        'hint-in': 'ob-in 0.35s ease',
        'pulse-ring': 'ob-pulse 2s ease-out infinite',
      },
    },
  },

  plugins: [
    plugin(({ addBase, addUtilities, addVariant, theme }) => {
      // ---- State variants -------------------------------------------------
      // JS only flips attributes (data-collapsed, data-mode, hidden, ...);
      // these variants turn that state into styling.
      addVariant('closed', '&[hidden]');                                         // [hidden] element
      addVariant('rail', '.group\\/app[data-collapsed="true"] &');               // side panel collapsed
      addVariant('detail', '.group\\/app[data-mode="detail"] &');                // zoomed in
      addVariant('overview', '.group\\/app[data-mode="overview"] &');            // zoomed out
      addVariant('drawer-open', '.group\\/app:has(#details-drawer:not([hidden])) &');
      addVariant('loading-map', 'body[data-loading~="map"] &');                  // skeleton states
      addVariant('loading-regions', 'body[data-loading~="regions"] &');
      addVariant('loading-search', 'body[data-loading~="search"] &');
      addVariant('mouse-nav', 'html:not(.kbd-nav) &:not(:focus-within)');        // keyboard-only UI

      // ---- Global focus ring (white-gap blue ring, works on light and dark) ----
      addBase({
        ':focus-visible': {
          outline: `3px solid ${theme('colors.focus.DEFAULT')}`,
          outlineOffset: '2px',
        },
        '.maplibregl-canvas:focus-visible': { outlineOffset: '-3px' },
      });

      // ---- Grid placement ---------------------------------------------------
      // area-map: anything that overlays the map cell (map, search, drawer, hint, load bar)
      const md = `@media (min-width: ${theme('screens.md')})`;
      addUtilities({
        '.area-panel': {
          gridColumn: '1', gridRow: '2',
          [md]: { gridColumn: '1', gridRow: '1' },
        },
        '.area-footer': {
          gridColumn: '1', gridRow: '3',
          [md]: { gridColumn: '1', gridRow: '2' },
        },
        '.area-map': {
          gridColumn: '1', gridRow: '1',
          [md]: { gridColumn: '2', gridRow: '1 / span 2' },
        },
      });
    }),
  ],
};