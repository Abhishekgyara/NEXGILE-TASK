/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
        mono: ['JetBrains Mono', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
      colors: {
        navy: {
          50: '#f0f4fa',
          100: '#d9e2ef',
          200: '#b3c5de',
          300: '#8aa3c7',
          400: '#5f7fab',
          500: '#3d5f8f',
          600: '#2c4872',
          700: '#1f3456',
          800: '#152340',
          900: '#0d1a30',
          950: '#081224',
        },
      },
      boxShadow: {
        card: '0 1px 2px 0 rgb(15 23 42 / 0.05), 0 1px 3px 0 rgb(15 23 42 / 0.08)',
        'card-hover': '0 12px 24px -10px rgb(15 23 42 / 0.18)',
      },
    },
  },
  plugins: [],
};
