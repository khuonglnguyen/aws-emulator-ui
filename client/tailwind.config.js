/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        aws: { DEFAULT: '#ff9900', dark: '#ec7211', navy: '#232f3e', navy2: '#161e2d' },
        brand: { DEFAULT: '#0972d3', hover: '#033160' },
      },
      fontFamily: {
        sans: ['"Open Sans"', 'Inter', 'system-ui', 'Segoe UI', 'Roboto', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
