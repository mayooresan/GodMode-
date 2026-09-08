/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Dark chart surfaces, one step apart so panels read as layered.
        surface: { 0: '#0d0d0c', 1: '#1a1a19', 2: '#232322', 3: '#2e2e2c' },
        ink: { primary: '#ffffff', secondary: '#c3c2b7', muted: '#8a8a80' },
        edge: '#3a3a37',
        good: '#25b14f',
        warning: '#c98500',
        serious: '#e07a2b',
        critical: '#ff4b4b',
        divine: '#c77dff',
      },
      fontFamily: {
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'Consolas', 'monospace'],
      },
    },
  },
  plugins: [],
};
